package config

import (
	"encoding/json"

	"github.com/startvibecoding/mothx/internal/platform"
	"github.com/startvibecoding/mothx/internal/sandbox"
)

// Verbose controls whether config loading prints diagnostic messages to stderr.
var Verbose bool

// Settings holds all configuration for vibecoding.
type Settings struct {
	Providers            map[string]*ProviderConfig `json:"providers,omitempty"`
	DefaultProvider      string                     `json:"defaultProvider,omitempty"`
	DefaultModel         string                     `json:"defaultModel,omitempty"`
	DefaultThinkingLevel string                     `json:"defaultThinkingLevel,omitempty"`
	DefaultMode          string                     `json:"defaultMode,omitempty"`
	StatusLine           StatusLineSettings         `json:"statusLine,omitempty"`
	EnablePlanTool       *bool                      `json:"enablePlanTool,omitempty"`
	WebSearch            WebSearchSettings          `json:"webSearch"`
	ImageGeneration      ImageGenerationSettings    `json:"imageGeneration"`
	MaxContextTokens     int                        `json:"maxContextTokens,omitempty"`
	ContextFiles         ContextFilesSettings       `json:"contextFiles"`
	SkillsDir            string                     `json:"skillsDir,omitempty"`
	SkillHub             SkillHubSettings           `json:"skillHub,omitempty"`
	Compaction           CompactionSettings         `json:"compaction"`
	Sandbox              SandboxSettings            `json:"sandbox"`
	SessionDir           string                     `json:"sessionDir,omitempty"`
	ShellPath            string                     `json:"shellPath,omitempty"`
	ShellCommandPrefix   string                     `json:"shellCommandPrefix,omitempty"`
	Theme                string                     `json:"theme,omitempty"`
	Retry                RetrySettings              `json:"retry"`
	Approval             ApprovalSettings           `json:"approval"`
	UpdateCheck          *bool                      `json:"updateCheck,omitempty"` // nil/true = check npm for updates on startup, false = disabled
}

func (s *Settings) UnmarshalJSON(data []byte) error {
	type settingsJSON Settings
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	providersRaw, hasProviders := raw["providers"]
	delete(raw, "providers")

	withoutProviders, err := json.Marshal(raw)
	if err != nil {
		return err
	}
	aux := settingsJSON(*s)
	if err := json.Unmarshal(withoutProviders, &aux); err != nil {
		return err
	}
	*s = Settings(aux)

	if !hasProviders {
		return nil
	}
	var providerEntries map[string]json.RawMessage
	if err := json.Unmarshal(providersRaw, &providerEntries); err != nil {
		return err
	}
	if s.Providers == nil {
		s.Providers = map[string]*ProviderConfig{}
	}
	for id, providerData := range providerEntries {
		pc := s.Providers[id]
		if pc == nil {
			pc = &ProviderConfig{}
		}
		if err := json.Unmarshal(providerData, pc); err != nil {
			return err
		}
		s.Providers[id] = pc
	}
	return nil
}

type ProviderConfig struct {
	Vendor         string            `json:"vendor,omitempty"`    // Explicit vendor adapter (Decision 12/13)
	APIKey         string            `json:"apiKey,omitempty"`    // API key or env/shell reference
	BaseURL        string            `json:"baseUrl,omitempty"`   // API base URL
	HTTPProxy      string            `json:"httpProxy,omitempty"` // optional per-provider HTTP proxy URL, e.g. http://127.0.0.1:7890
	ForceHTTP11    bool              `json:"forceHTTP11,omitempty"`
	Headers        map[string]string `json:"headers,omitempty"` // optional per-provider HTTP headers
	API            string            `json:"api,omitempty"`
	ThinkingFormat string            `json:"thinkingFormat,omitempty"` // "", "openai", "anthropic", "deepseek", "xiaomi"
	CacheControl   *bool             `json:"cacheControl,omitempty"`   // enable Anthropic prompt caching (nil/false=off, true=on; set true for Claude models)
	// MaxImagesPerRequest limits image blocks sent to OpenAI-compatible APIs.
	// Zero uses the provider default; -1 disables the client-side limit.
	MaxImagesPerRequest int             `json:"maxImagesPerRequest,omitempty"`
	Responses           ResponsesConfig `json:"responses,omitempty"`
	Models              []ModelConfig   `json:"models"`

	fieldSet map[string]bool `json:"-"`
}

type ResponsesConfig struct {
	ReasoningSummary     string                          `json:"reasoningSummary,omitempty"`     // "auto" (default), "concise", or "detailed"
	ReasoningContext     string                          `json:"reasoningContext,omitempty"`     // auto, current_turn, all_turns
	ReasoningMode        string                          `json:"reasoningMode,omitempty"`        // standard, pro
	PromptCacheEnabled   *bool                           `json:"promptCacheEnabled,omitempty"`   // nil/true = on, false = off
	PromptCacheKey       string                          `json:"promptCacheKey,omitempty"`       // optional explicit cache key; defaults to provider/model stable key
	PromptCacheRetention string                          `json:"promptCacheRetention,omitempty"` // optional OpenAI prompt cache retention value
	PromptCacheMode      string                          `json:"promptCacheMode,omitempty"`      // implicit, explicit
	PromptCacheTTL       string                          `json:"promptCacheTTL,omitempty"`       // e.g. 5m, 1h
	SafetyIdentifier     string                          `json:"safetyIdentifier,omitempty"`
	Metadata             map[string]string               `json:"metadata,omitempty"`
	StateMode            string                          `json:"stateMode,omitempty"` // replay, previous_response_id, conversation
	Store                *bool                           `json:"store,omitempty"`
	Conversation         string                          `json:"conversation,omitempty"`
	Truncation           string                          `json:"truncation,omitempty"`
	Background           *bool                           `json:"background,omitempty"`
	Include              []string                        `json:"include,omitempty"`
	ServiceTier          string                          `json:"serviceTier,omitempty"`
	StructuredOutput     ResponsesStructuredOutputConfig `json:"structuredOutput,omitempty"`
	ToolControl          ResponsesToolControlConfig      `json:"toolControl,omitempty"`
	HostedTools          ResponsesHostedToolsConfig      `json:"hostedTools,omitempty"`
}

type ResponsesStructuredOutputConfig struct {
	Name        string          `json:"name,omitempty"`
	Description string          `json:"description,omitempty"`
	Strict      *bool           `json:"strict,omitempty"`
	Schema      json.RawMessage `json:"schema,omitempty"`
}

type ResponsesToolControlConfig struct {
	Choice   string `json:"choice,omitempty"`
	Parallel *bool  `json:"parallel,omitempty"`
	MaxCalls int    `json:"maxCalls,omitempty"`
}

type ResponsesHostedToolsConfig struct {
	WebSearch       map[string]any   `json:"webSearch,omitempty"`
	FileSearch      map[string]any   `json:"fileSearch,omitempty"`
	CodeInterpreter map[string]any   `json:"codeInterpreter,omitempty"`
	ComputerUse     map[string]any   `json:"computerUse,omitempty"`
	ImageGeneration map[string]any   `json:"imageGeneration,omitempty"`
	RemoteMCP       []map[string]any `json:"remoteMCP,omitempty"`
}

type WebSearchSettings struct {
	Enabled      *bool  `json:"enabled,omitempty"`
	Provider     string `json:"provider,omitempty"`
	ProviderType string `json:"providerType,omitempty"`
	Model        string `json:"model,omitempty"`
}

// ImageGenerationSettings configures the standalone local image_generation
// tool. The endpoint and credential are independent from the chat provider.
type ImageGenerationSettings struct {
	Enabled  *bool  `json:"enabled,omitempty"`
	Provider string `json:"provider,omitempty"`
	APIType  string `json:"apiType,omitempty"`
	BaseURL  string `json:"baseUrl,omitempty"`
	Token    string `json:"token,omitempty"`
	Model    string `json:"model,omitempty"`
}

type SkillHubMarketSettings struct {
	ID       string `json:"id"`
	Name     string `json:"name,omitempty"`
	SiteURL  string `json:"siteURL,omitempty"`
	APIURL   string `json:"apiURL,omitempty"`
	Enabled  bool   `json:"enabled"`
	APIToken string `json:"apiToken,omitempty"`
}

type SkillHubSettings struct {
	DefaultMarket       string                   `json:"defaultMarket,omitempty"`
	DefaultInstallScope string                   `json:"defaultInstallScope,omitempty"`
	OfficialHandles     []string                 `json:"officialHandles,omitempty"`
	Markets             []SkillHubMarketSettings `json:"markets,omitempty"`
}

const DefaultSkillHubOfficialHandle = "user_0064faa7"

type StatusLineSettings struct {
	Enabled         bool   `json:"enabled,omitempty"`
	Type            string `json:"type,omitempty"`
	Command         string `json:"command,omitempty"`
	Padding         int    `json:"padding,omitempty"`
	RefreshInterval int    `json:"refreshInterval,omitempty"`
	TimeoutMs       int    `json:"timeoutMs,omitempty"`
	Fallback        string `json:"fallback,omitempty"`
}

type ModelConfig struct {
	ID            string       `json:"id"`
	Name          string       `json:"name"`
	Reasoning     bool         `json:"reasoning,omitempty"`
	ContextWindow int          `json:"contextWindow,omitempty"`
	MaxTokens     int          `json:"maxTokens,omitempty"`
	Temperature   *float64     `json:"temperature,omitempty"` // nil = use API default
	TopP          *float64     `json:"top_p,omitempty"`       // nil = use API default
	Cost          *CostConfig  `json:"cost,omitempty"`
	Input         []string     `json:"input,omitempty"`
	Compat        *ModelCompat `json:"compat,omitempty"` // Vendor compatibility flags (Decision 14)

	fieldSet map[string]bool `json:"-"`
}

type CostConfig struct {
	Input      float64 `json:"input"`
	Output     float64 `json:"output"`
	CacheRead  float64 `json:"cacheRead,omitempty"`
	CacheWrite float64 `json:"cacheWrite,omitempty"`
}

func (pc *ProviderConfig) UnmarshalJSON(data []byte) error {
	type providerConfigJSON ProviderConfig
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	aux := providerConfigJSON(*pc)
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	*pc = ProviderConfig(aux)
	pc.fieldSet = cloneFieldSet(pc.fieldSet)
	if pc.fieldSet == nil {
		pc.fieldSet = make(map[string]bool, len(raw))
	}
	for k := range raw {
		pc.fieldSet[k] = true
	}
	return nil
}

func (mc *ModelConfig) UnmarshalJSON(data []byte) error {
	type modelConfigJSON ModelConfig
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	aux := modelConfigJSON(*mc)
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	*mc = ModelConfig(aux)
	mc.fieldSet = cloneFieldSet(mc.fieldSet)
	if mc.fieldSet == nil {
		mc.fieldSet = make(map[string]bool, len(raw))
	}
	for k := range raw {
		mc.fieldSet[k] = true
	}
	return nil
}

func configFieldWasSet(fields map[string]bool, name string) bool {
	return fields != nil && fields[name]
}

func markConfigField(fields map[string]bool, name string) map[string]bool {
	if fields == nil {
		fields = make(map[string]bool, 1)
	}
	fields[name] = true
	return fields
}

func (mc ModelConfig) MaxTokensWasSet() bool {
	return configFieldWasSet(mc.fieldSet, "maxTokens")
}

// SetMaxTokens records an explicit output-token setting. A value of zero means
// use the provider default and must remain distinguishable from an omitted value.
func (mc *ModelConfig) SetMaxTokens(value int) {
	mc.MaxTokens = value
	mc.fieldSet = markConfigField(mc.fieldSet, "maxTokens")
}

// MarshalJSON preserves an explicitly configured zero maxTokens value. This
// lets the TUI and WebUI express "do not send an output token limit" while
// keeping ordinary omitted values sparse.
func (mc ModelConfig) MarshalJSON() ([]byte, error) {
	type modelConfigJSON ModelConfig
	data, err := json.Marshal(modelConfigJSON(mc))
	if err != nil || !mc.MaxTokensWasSet() || mc.MaxTokens != 0 {
		return data, err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	raw["maxTokens"] = json.RawMessage("0")
	return json.Marshal(raw)
}

// ModelCompat defines per-model compatibility flags (Decision 14).
// Reference: pi/packages/ai/src/models.generated.ts compat field
type ModelCompat struct {
	// Thinking/reasoning
	ThinkingFormat                              string `json:"thinkingFormat,omitempty"`
	RequiresReasoningContentOnAssistant         bool   `json:"requiresReasoningContentOnAssistant,omitempty"`
	RequiresReasoningContentOnAssistantMessages bool   `json:"requiresReasoningContentOnAssistantMessages,omitempty"`
	ForceAdaptiveThinking                       bool   `json:"forceAdaptiveThinking,omitempty"`
	// ParseReasoningInContent extracts reasoning wrapped in <think>...</think>
	// tags from the content stream (for models that inline thinking in the body
	// instead of using a separate reasoning_content field).
	ParseReasoningInContent bool `json:"parseReasoningInContent,omitempty"`

	// API parameter compatibility
	SupportsDeveloperRole      *bool           `json:"supportsDeveloperRole,omitempty"`
	SupportsStore              *bool           `json:"supportsStore,omitempty"`
	SupportsResponses          *bool           `json:"supportsResponses,omitempty"`
	SupportsPreviousResponseID *bool           `json:"supportsPreviousResponseId,omitempty"`
	SupportsConversation       *bool           `json:"supportsConversation,omitempty"`
	SupportsBackground         *bool           `json:"supportsBackground,omitempty"`
	SupportsStructuredOutput   *bool           `json:"supportsStructuredOutput,omitempty"`
	SupportsServiceTier        *bool           `json:"supportsServiceTier,omitempty"`
	SupportsParallelToolCalls  *bool           `json:"supportsParallelToolCalls,omitempty"`
	SupportsToolChoice         *bool           `json:"supportsToolChoice,omitempty"`
	SupportsHostedTools        map[string]bool `json:"supportsHostedTools,omitempty"`
	SupportedInclude           []string        `json:"supportedInclude,omitempty"`
	SupportsReasoningEffort    *bool           `json:"supportsReasoningEffort,omitempty"`
	SupportsStrictMode         *bool           `json:"supportsStrictMode,omitempty"`
	MaxTokensField             string          `json:"maxTokensField,omitempty"`
	// DisableSamplingParams omits temperature/top_p from requests. It defaults
	// to true (nil): sampling parameters are only sent when explicitly set to
	// false for models that accept them.
	DisableSamplingParams *bool `json:"disableSamplingParams,omitempty"`

	// Cache
	SupportsCacheControlOnTools *bool `json:"supportsCacheControlOnTools,omitempty"`
	SupportsLongCacheRetention  *bool `json:"supportsLongCacheRetention,omitempty"`
	SupportsPromptCacheKey      *bool `json:"supportsPromptCacheKey,omitempty"`
	SupportsReasoningSummary    *bool `json:"supportsReasoningSummary,omitempty"`
	SendSessionAffinityHeaders  bool  `json:"sendSessionAffinityHeaders,omitempty"`

	// Streaming
	SupportsEagerToolInputStreaming *bool `json:"supportsEagerToolInputStreaming,omitempty"`
}

// BoolPtr returns a pointer to the given bool value.
func BoolPtr(v bool) *bool { return &v }

type ContextFilesSettings struct {
	Enabled    bool     `json:"enabled"`
	ExtraFiles []string `json:"extraFiles,omitempty"`
}

type CompactionSettings struct {
	Enabled          bool   `json:"enabled"`
	ReserveTokens    int    `json:"reserveTokens"`
	KeepRecentTokens int    `json:"keepRecentTokens"`
	Tokenizer        string `json:"tokenizer,omitempty"`
	TokenizerModel   string `json:"tokenizerModel,omitempty"`
	Template         string `json:"template,omitempty"`
}

type SandboxSettings struct {
	Enabled      bool     `json:"enabled"`
	Level        string   `json:"level"`
	BwrapPath    string   `json:"bwrapPath,omitempty"`
	AllowNetwork bool     `json:"allowNetwork"`
	AllowedRead  []string `json:"allowedRead,omitempty"`
	AllowedWrite []string `json:"allowedWrite,omitempty"`
	DeniedPaths  []string `json:"deniedPaths,omitempty"`
	PassEnv      []string `json:"passEnv,omitempty"`
	TmpSize      string   `json:"tmpSize,omitempty"`
	ProtectGit   bool     `json:"protectGit,omitempty"`
}

func (s SandboxSettings) Options() sandbox.Options {
	return sandbox.Options{
		BwrapPath: s.BwrapPath, AllowNetwork: s.AllowNetwork,
		AllowedRead: s.AllowedRead, AllowedWrite: s.AllowedWrite,
		DeniedPaths: s.DeniedPaths, PassEnv: s.PassEnv, TmpSize: s.TmpSize,
		ProtectGit: s.ProtectGit,
	}
}

type RetrySettings struct {
	Enabled     bool `json:"enabled"`
	MaxRetries  int  `json:"maxRetries"`
	BaseDelayMs int  `json:"baseDelayMs"`
}

type ApprovalSettings struct {
	// BashWhitelist is a list of command prefixes that auto-approve in agent mode
	BashWhitelist []string `json:"bashWhitelist,omitempty"`
	// BashBlacklist is a list of command prefixes that always require approval (even in yolo mode if configured)
	BashBlacklist []string `json:"bashBlacklist,omitempty"`
	// ConfirmBeforeWrite requires user approval before write/edit tools run in agent mode.
	ConfirmBeforeWrite *bool `json:"confirmBeforeWrite,omitempty"`
}

func DefaultSettings() *Settings {
	return &Settings{
		Providers:            cloneProviderConfigs(defaultProviderConfigs),
		DefaultProvider:      "deepseek-openai",
		DefaultModel:         "deepseek-v4-flash",
		DefaultThinkingLevel: "medium",
		DefaultMode:          "agent",
		StatusLine: StatusLineSettings{
			Enabled:   false,
			Type:      "command",
			Padding:   0,
			TimeoutMs: 800,
			Fallback:  "builtin",
		},
		EnablePlanTool:  boolPtr(true),
		WebSearch:       WebSearchSettings{Enabled: boolPtr(false), Provider: "openai", ProviderType: "openai-responses"},
		ImageGeneration: ImageGenerationSettings{Enabled: boolPtr(false), Provider: "openai", APIType: "openai-images", BaseURL: "https://api.openai.com/v1", Model: "gpt-image-1"},
		ContextFiles:    ContextFilesSettings{Enabled: true},
		SkillsDir:       platform.SkillsDir(),
		SkillHub: SkillHubSettings{
			DefaultMarket:       "skillhub.cn",
			DefaultInstallScope: "project",
			OfficialHandles:     []string{DefaultSkillHubOfficialHandle},
		},
		Compaction: CompactionSettings{Enabled: true, ReserveTokens: 16384, KeepRecentTokens: 20000},
		Sandbox: SandboxSettings{
			Enabled:     false,
			Level:       "none",
			AllowedRead: platform.SandboxPaths(),
			DeniedPaths: platform.DeniedPaths(),
			PassEnv:     platform.DefaultEnvVars(),
			TmpSize:     "100m",
			ProtectGit:  true,
		},
		SessionDir: platform.SessionDir(),
		Theme:      "dark",
		Retry:      RetrySettings{Enabled: true, MaxRetries: 5, BaseDelayMs: 3000},
		Approval: ApprovalSettings{
			BashWhitelist:      []string{"go ", "make ", "git ", "npm ", "yarn ", "node ", "python ", "pip "},
			ConfirmBeforeWrite: boolPtr(true),
		},
	}
}

func defaultSettingsFile() *Settings {
	s := DefaultSettings()
	s.Providers = nil
	return s
}
