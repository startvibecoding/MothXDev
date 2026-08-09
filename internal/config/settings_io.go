package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/startvibecoding/mothx/internal/platform"
)

func ConfigDir() string {
	return platform.ConfigDir()
}

func GlobalSettingsPath() string {
	return filepath.Join(ConfigDir(), "settings.json")
}

func ProjectSettingsPath() string {
	return ProjectPath("settings.json")
}

func LoadSettings() (*Settings, error) {
	s, _, err := LoadSettingsWithMeta()
	return s, err
}

// LoadMeta describes side effects and paths from settings loading.
type LoadMeta struct {
	CreatedGlobalConfig bool
	GlobalSettingsPath  string
}

// LoadSettingsWithMeta loads settings and reports whether the global settings
// file was created during this call. The loaded schema is the same as LoadSettings.
func LoadSettingsWithMeta() (*Settings, LoadMeta, error) {
	s := DefaultSettings()
	meta := LoadMeta{GlobalSettingsPath: GlobalSettingsPath()}

	created, err := ensureConfigExists()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Warning: could not create config: %v\n", err)
	} else {
		meta.CreatedGlobalConfig = created
	}

	globalPath := GlobalSettingsPath()
	if Verbose {
		fmt.Fprintf(os.Stderr, "[config] Loading global settings: %s\n", globalPath)
	}
	if data, err := os.ReadFile(globalPath); err == nil {
		candidate := *s
		if err := json.Unmarshal(data, &candidate); err != nil {
			if backupErr := backupCorruptSettings(globalPath); backupErr != nil {
				return nil, meta, fmt.Errorf("parse global settings: %w (backup failed: %v)", err, backupErr)
			}
			fmt.Fprintf(os.Stderr, "Warning: invalid global settings backed up; using defaults: %v\n", err)
		} else {
			s = &candidate
		}
		if Verbose {
			fmt.Fprintf(os.Stderr, "[config] Loaded global settings\n")
		}
	} else if !os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "Warning: could not read global settings %s: %v\n", globalPath, err)
	} else if Verbose {
		fmt.Fprintf(os.Stderr, "[config] Global settings not found: %s\n", globalPath)
	}

	projectPath := ProjectSettingsPath()
	if Verbose {
		fmt.Fprintf(os.Stderr, "[config] Loading project settings: %s\n", projectPath)
	}
	if data, err := os.ReadFile(projectPath); err == nil {
		candidate := *s
		if err := json.Unmarshal(data, &candidate); err != nil {
			if backupErr := backupCorruptSettings(projectPath); backupErr != nil {
				return nil, meta, fmt.Errorf("parse project settings: %w (backup failed: %v)", err, backupErr)
			}
			fmt.Fprintf(os.Stderr, "Warning: invalid project settings backed up and ignored: %v\n", err)
		} else {
			s = &candidate
		}
		if Verbose {
			fmt.Fprintf(os.Stderr, "[config] Loaded project settings\n")
		}
	} else if !os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "Warning: could not read project settings %s: %v\n", projectPath, err)
	} else if Verbose {
		fmt.Fprintf(os.Stderr, "[config] Project settings not found: %s\n", projectPath)
		// Detect common typo: .mothx/setting.json (singular)
		if _, err2 := os.Stat(ProjectPath("setting.json")); err2 == nil {
			fmt.Fprintf(os.Stderr, "[config] Found %s (singular) — expected %s (plural). Please rename the file.\n", ProjectPath("setting.json"), projectPath)
		}
	}

	if v := os.Getenv("VIBECODING_PROVIDER"); v != "" {
		s.DefaultProvider = v
	}
	if v := os.Getenv("VIBECODING_MODEL"); v != "" {
		s.DefaultModel = v
	}
	if v := os.Getenv("VIBECODING_MODE"); v != "" {
		s.DefaultMode = v
	}
	if v := os.Getenv("VIBECODING_THINKING"); v != "" {
		s.DefaultThinkingLevel = v
	}

	return s, meta, nil
}

func backupCorruptSettings(path string) error {
	absolutePath, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve settings path %s: %w", path, err)
	}

	stamp := time.Now().Format("20060102-150405")
	backupPath := absolutePath + ".bak_" + stamp
	for i := 1; ; i++ {
		if _, err := os.Stat(backupPath); os.IsNotExist(err) {
			break
		}
		backupPath = fmt.Sprintf("%s.bak_%s_%d", absolutePath, stamp, i)
	}
	if err := os.Rename(absolutePath, backupPath); err != nil {
		return fmt.Errorf("rename %s to %s: %w", absolutePath, backupPath, err)
	}
	fmt.Fprintf(os.Stderr, "Warning: corrupt settings backed up to %s\n", backupPath)
	return nil
}

func ensureConfigExists() (bool, error) {
	configDir := ConfigDir()
	settingsPath := GlobalSettingsPath()

	if _, err := os.Stat(settingsPath); err == nil {
		return false, nil
	}

	if err := os.MkdirAll(configDir, 0700); err != nil {
		return false, fmt.Errorf("create config directory: %w", err)
	}

	data, err := json.MarshalIndent(defaultSettingsFile(), "", "  ")
	if err != nil {
		return false, fmt.Errorf("marshal default settings: %w", err)
	}

	if err := os.WriteFile(settingsPath, data, 0600); err != nil {
		return false, fmt.Errorf("write settings file: %w", err)
	}

	fmt.Fprintf(os.Stderr, "Created default config: %s\n", settingsPath)
	return true, nil
}

// LoadGlobalSettingsOrDefault loads only the global settings file over defaults.
// It intentionally does not apply project settings or environment overrides, so
// callers that need a full runnable global config can avoid persisting runtime state.
func LoadGlobalSettingsOrDefault() (*Settings, error) {
	s := DefaultSettings()
	globalPath := GlobalSettingsPath()
	if data, err := os.ReadFile(globalPath); err == nil {
		if err := json.Unmarshal(data, s); err != nil {
			return nil, fmt.Errorf("parse global settings: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("read global settings %s: %w", globalPath, err)
	}
	return s, nil
}

// LoadGlobalSettingsSparse loads only fields explicitly present in the global
// settings file. If the file does not exist, it returns an empty Settings.
// Use this for patch-style writes so defaults are not expanded into settings.json.
func LoadGlobalSettingsSparse() (*Settings, error) {
	s := &Settings{}
	globalPath := GlobalSettingsPath()
	if data, err := os.ReadFile(globalPath); err == nil {
		if err := json.Unmarshal(data, s); err != nil {
			return nil, fmt.Errorf("parse global settings: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("read global settings %s: %w", globalPath, err)
	}
	if s.Providers == nil {
		s.Providers = map[string]*ProviderConfig{}
	}
	return s, nil
}

// LoadProjectSettingsSparse loads only fields explicitly present in the project
// settings file. If the file does not exist, it returns an empty Settings.
func LoadProjectSettingsSparse() (*Settings, error) {
	s := &Settings{}
	projectPath := ProjectSettingsPath()
	if data, err := os.ReadFile(projectPath); err == nil {
		if err := json.Unmarshal(data, s); err != nil {
			return nil, fmt.Errorf("parse project settings: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("read project settings %s: %w", projectPath, err)
	}
	if s.Providers == nil {
		s.Providers = map[string]*ProviderConfig{}
	}
	return s, nil
}

// SaveGlobalSettings writes settings.json atomically with private permissions.
func SaveGlobalSettings(s *Settings) error {
	if s == nil {
		return fmt.Errorf("settings is nil")
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal settings: %w", err)
	}
	return writeGlobalSettingsData(data)
}

// SaveGlobalSettingsPatch updates only the given top-level keys in the global
// settings file. It preserves keys that are already present without expanding
// defaults into settings.json.
func SaveGlobalSettingsPatch(updates map[string]any) error {
	if len(updates) == 0 {
		return nil
	}
	existing := map[string]json.RawMessage{}
	settingsPath := GlobalSettingsPath()
	if data, err := os.ReadFile(settingsPath); err == nil {
		if err := json.Unmarshal(data, &existing); err != nil {
			return fmt.Errorf("parse global settings: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("read global settings %s: %w", settingsPath, err)
	}
	// Output limits are configured per model. Drop the retired global setting
	// whenever this sparse file is rewritten.
	delete(existing, "maxOutputTokens")
	for key, value := range updates {
		if key == "" {
			continue
		}
		if value == nil {
			delete(existing, key)
			continue
		}
		data, err := json.Marshal(value)
		if err != nil {
			return fmt.Errorf("marshal settings key %s: %w", key, err)
		}
		existing[key] = data
	}
	data, err := json.MarshalIndent(existing, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal settings patch: %w", err)
	}
	return writeGlobalSettingsData(data)
}

func writeGlobalSettingsData(data []byte) error {
	configDir := ConfigDir()
	if err := os.MkdirAll(configDir, 0700); err != nil {
		return fmt.Errorf("create config directory: %w", err)
	}
	settingsPath := GlobalSettingsPath()
	tmp, err := os.CreateTemp(configDir, "settings-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp settings: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write temp settings: %w", err)
	}
	if err := tmp.Chmod(0600); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("chmod temp settings: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp settings: %w", err)
	}
	if err := os.Rename(tmpName, settingsPath); err != nil {
		return fmt.Errorf("replace settings: %w", err)
	}
	return nil
}

// SaveProjectSettings writes .mothx/settings.json atomically with private permissions.
func SaveProjectSettings(s *Settings) error {
	if s == nil {
		return fmt.Errorf("settings is nil")
	}
	projectDir := filepath.Dir(ProjectSettingsPath())
	if err := os.MkdirAll(projectDir, 0700); err != nil {
		return fmt.Errorf("create project config directory: %w", err)
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal settings: %w", err)
	}
	settingsPath := ProjectSettingsPath()
	tmp, err := os.CreateTemp(projectDir, "settings-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp settings: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write temp settings: %w", err)
	}
	if err := tmp.Chmod(0600); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("chmod temp settings: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp settings: %w", err)
	}
	if err := os.Rename(tmpName, settingsPath); err != nil {
		return fmt.Errorf("replace settings: %w", err)
	}
	return nil
}
