package config

import (
	"os"
	"os/exec"
	"strings"

	"github.com/startvibecoding/mothx/internal/platform"
)

func (s *Settings) ResolveKey(providerName string) string {
	// 1. Use apiKey from provider config (supports ${VAR} env references)
	if pc, ok := s.Providers[providerName]; ok && pc != nil && pc.APIKey != "" {
		return resolveKeyValue(pc.APIKey)
	}
	// 2. Fallback: apiKey from the built-in provider preset (supports ${VAR}
	// env references). Unresolved ${VAR} placeholders fall through so the
	// derived env-var lookup below still applies.
	if pc := DefaultProviderConfig(providerName); pc != nil && pc.APIKey != "" {
		if v := resolveKeyValue(pc.APIKey); v != "" && !strings.HasPrefix(v, "${") && !strings.HasPrefix(v, "!") {
			return v
		}
	}
	// 3. Fallback: derive env var from provider name, e.g. "deepseek-openai" → "DEEPSEEK_OPENAI_API_KEY"
	envVar := providerToEnvVar(providerName)
	if v := os.Getenv(envVar); v != "" {
		return v
	}
	return ""
}

// ResolveProviderHeaders resolves configured per-provider HTTP header values.
// Header values use the same env-var and shell-command resolution rules as apiKey.
func (s *Settings) ResolveProviderHeaders(providerName string) map[string]string {
	if s == nil {
		return nil
	}
	// Merge built-in preset headers (e.g. kimi-coding's User-Agent) with the
	// runtime provider entry; a configured headers map replaces the preset.
	pc := ResolveProviderConfig(providerName, s)
	if pc == nil || len(pc.Headers) == 0 {
		return nil
	}
	headers := make(map[string]string, len(pc.Headers))
	for name, value := range pc.Headers {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		headers[name] = resolveKeyValue(value)
	}
	return headers
}

// providerToEnvVar converts a provider name to a conventional environment variable name.
// e.g. "deepseek-openai" → "DEEPSEEK_OPENAI_API_KEY", "my-provider" → "MY_PROVIDER_API_KEY".
func providerToEnvVar(name string) string {
	return strings.ToUpper(strings.ReplaceAll(name, "-", "_")) + "_API_KEY"
}

func resolveKeyValue(key string) string {
	if strings.HasPrefix(key, "!") {
		if os.Getenv("VIBECODING_ALLOW_SHELL_CONFIG") != "1" {
			return key
		}
		return resolveShellCommand(key[1:])
	}

	// Handle ${VAR} syntax: look up the variable name inside ${}
	envName := key
	if strings.HasPrefix(key, "${") && strings.HasSuffix(key, "}") {
		envName = key[2 : len(key)-1]
	}

	if !strings.Contains(envName, " ") {
		if v := os.Getenv(envName); v != "" {
			return v
		}
	}

	return key
}

func (s *Settings) GetProviderConfig(name string) *ProviderConfig {
	return s.Providers[name]
}

func (s *Settings) GetModelConfig(providerName, modelID string) *ModelConfig {
	pc := s.GetProviderConfig(providerName)
	if pc == nil {
		return nil
	}
	for _, m := range pc.Models {
		if m.ID == modelID {
			return &m
		}
	}
	return nil
}

func resolveShellCommand(cmd string) string {
	if cmd == "" {
		return ""
	}
	var out []byte
	var err error
	if platform.IsWindows() {
		out, err = exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", cmd).Output()
	} else {
		out, err = exec.Command("sh", "-c", cmd).Output()
	}
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}
