package config

import (
	"path/filepath"
	"runtime"
	"strings"

	"github.com/startvibecoding/mothx/internal/platform"
)

func (s *Settings) GetShell() string {
	if s.ShellPath != "" {
		return s.ShellPath
	}
	return platform.DefaultShell()
}

func (s *Settings) GetSessionDir() string {
	if s.SessionDir != "" {
		return normalizeLegacyDefaultDir(s.SessionDir, filepath.Join(platform.LegacyConfigDir(), "sessions"), platform.SessionDir())
	}
	return platform.SessionDir()
}

func (s *Settings) GetGlobalSkillsDir() string {
	if s.SkillsDir != "" {
		return normalizeLegacyDefaultDir(s.SkillsDir, filepath.Join(platform.LegacyConfigDir(), "skills"), platform.SkillsDir())
	}
	return platform.SkillsDir()
}

func normalizeLegacyDefaultDir(configured, legacyDefault, currentDefault string) string {
	resolved := configured
	if strings.HasPrefix(resolved, "~") {
		resolved = platform.ExpandHome(resolved)
	}
	if sameConfigPath(resolved, legacyDefault) {
		return currentDefault
	}
	return resolved
}

func sameConfigPath(a, b string) bool {
	a = filepath.Clean(a)
	b = filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

func (s *Settings) IsPlanToolEnabled() bool {
	if s.EnablePlanTool == nil {
		return true
	}
	return *s.EnablePlanTool
}

// IsUpdateCheckEnabled reports whether startup update checks against the npm
// registry are enabled. Defaults to true when unset.
func (s *Settings) IsUpdateCheckEnabled() bool {
	if s == nil || s.UpdateCheck == nil {
		return true
	}
	return *s.UpdateCheck
}

func (s *Settings) IsWebSearchEnabled() bool {
	if s == nil || s.WebSearch.Enabled == nil {
		return false
	}
	return *s.WebSearch.Enabled
}

func (s *Settings) IsImageGenerationEnabled() bool {
	if s == nil || s.ImageGeneration.Enabled == nil {
		return false
	}
	return *s.ImageGeneration.Enabled
}

// EffectiveImageGeneration returns the standalone image-generation config,
// filling omitted endpoint/API/token fields from the selected provider.
func (s *Settings) EffectiveImageGeneration() ImageGenerationSettings {
	if s == nil {
		return ImageGenerationSettings{}
	}
	cfg := s.ImageGeneration
	if cfg.Provider == "" {
		cfg.Provider = "openai"
	}
	if pc := ResolveProviderConfig(cfg.Provider, s); pc != nil {
		if cfg.BaseURL == "" {
			cfg.BaseURL = pc.BaseURL
		}
		if cfg.APIType == "" {
			cfg.APIType = pc.API
		}
		if cfg.Token == "" {
			cfg.Token = pc.APIKey
		}
	}
	if cfg.APIType == "" {
		cfg.APIType = "openai-images"
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = "https://api.openai.com/v1"
	}
	if cfg.Model == "" {
		cfg.Model = "gpt-image-1"
	}
	cfg.Token = resolveKeyValue(cfg.Token)
	return cfg
}

// ResolveImageGenerationToken resolves environment/shell references in the
// standalone image-generation token without exposing the resolver itself.
func (s *Settings) ResolveImageGenerationToken() string {
	return s.EffectiveImageGeneration().Token
}

func mergeWebSearchSettings(base, override WebSearchSettings) WebSearchSettings {
	if override.Enabled != nil {
		base.Enabled = boolPtr(*override.Enabled)
	}
	if override.Provider != "" {
		base.Provider = override.Provider
		if override.ProviderType == "" {
			base.ProviderType = ""
		}
	}
	if override.ProviderType != "" {
		base.ProviderType = override.ProviderType
	}
	if override.Model != "" {
		base.Model = override.Model
	}
	return normalizeWebSearchSettings(base)
}

func normalizeWebSearchSettings(cfg WebSearchSettings) WebSearchSettings {
	if cfg.Enabled == nil {
		cfg.Enabled = boolPtr(false)
	}
	if cfg.Provider == "" {
		cfg.Provider = "openai"
	}
	if cfg.ProviderType == "" {
		switch cfg.Provider {
		case "anthropic":
			cfg.ProviderType = "anthropic-messages"
		default:
			cfg.ProviderType = "openai-responses"
		}
	}
	return cfg
}

// DefaultProviderConfigs returns a deep copy of all built-in provider presets.
// The returned map is safe for callers to modify without affecting the global defaults.
