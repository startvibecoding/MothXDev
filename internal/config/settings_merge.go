package config

func DefaultProviderConfigs() map[string]*ProviderConfig {
	return cloneProviderConfigs(defaultProviderConfigs)
}

// DefaultProviderConfig returns a deep copy of a single built-in provider preset,
// or nil if the provider ID has no built-in default.
func DefaultProviderConfig(providerID string) *ProviderConfig {
	src, ok := defaultProviderConfigs[providerID]
	if !ok || src == nil {
		return nil
	}
	return cloneProviderConfig(src)
}

// DefaultModelConfig returns a deep copy of a specific model's built-in config
// under a given provider. Returns nil if the provider or model is unknown.
func DefaultModelConfig(providerID, modelID string) *ModelConfig {
	pc, ok := defaultProviderConfigs[providerID]
	if !ok || pc == nil {
		return nil
	}
	for i := range pc.Models {
		if pc.Models[i].ID == modelID {
			cm := cloneModelConfig(pc.Models[i])
			return &cm
		}
	}
	return nil
}

// ResolveProviderConfig merges built-in provider defaults with runtime overrides.
// Priority: runtime settings > built-in defaults > safe generic defaults.
func ResolveProviderConfig(providerID string, runtime *Settings) *ProviderConfig {
	base := DefaultProviderConfig(providerID)
	if base == nil {
		base = &ProviderConfig{API: "openai-chat"}
	}
	if runtime != nil {
		if existing, ok := runtime.Providers[providerID]; ok && existing != nil {
			base = mergeProviderConfig(base, existing)
		}
	}
	return base
}

// ResolveModelConfig merges built-in model defaults with runtime overrides.
func ResolveModelConfig(providerID, modelID string, runtime *Settings) *ModelConfig {
	base := DefaultModelConfig(providerID, modelID)
	if runtime != nil && runtime.Providers != nil {
		if existing := runtime.GetModelConfig(providerID, modelID); existing != nil {
			if base == nil {
				cm := cloneModelConfig(*existing)
				return &cm
			}
			merged := mergeModelConfig(*base, *existing)
			return &merged
		}
	}
	if base != nil {
		return base
	}
	if runtime != nil {
		if existing := runtime.GetModelConfig(providerID, modelID); existing != nil {
			cm := cloneModelConfig(*existing)
			return &cm
		}
	}
	return nil
}

// mergeProviderConfig overlays non-zero fields from `overlay` onto `base`.
// nil *bool fields in overlay are treated as "unset" and do not overwrite base.
func mergeProviderConfig(base, overlay *ProviderConfig) *ProviderConfig {
	if overlay == nil {
		return base
	}
	if base == nil {
		return cloneProviderConfig(overlay)
	}
	result := cloneProviderConfig(base)
	if configFieldWasSet(overlay.fieldSet, "apiKey") || (overlay.fieldSet == nil && overlay.APIKey != "") {
		result.APIKey = overlay.APIKey
	}
	if configFieldWasSet(overlay.fieldSet, "baseUrl") || (overlay.fieldSet == nil && overlay.BaseURL != "") {
		result.BaseURL = overlay.BaseURL
	}
	if configFieldWasSet(overlay.fieldSet, "api") || (overlay.fieldSet == nil && overlay.API != "") {
		result.API = overlay.API
	}
	if configFieldWasSet(overlay.fieldSet, "vendor") || (overlay.fieldSet == nil && overlay.Vendor != "") {
		result.Vendor = overlay.Vendor
	}
	if configFieldWasSet(overlay.fieldSet, "httpProxy") || (overlay.fieldSet == nil && overlay.HTTPProxy != "") {
		result.HTTPProxy = overlay.HTTPProxy
	}
	if configFieldWasSet(overlay.fieldSet, "forceHTTP11") || (overlay.fieldSet == nil && overlay.ForceHTTP11) {
		result.ForceHTTP11 = overlay.ForceHTTP11
	}
	if configFieldWasSet(overlay.fieldSet, "thinkingFormat") || (overlay.fieldSet == nil && overlay.ThinkingFormat != "") {
		result.ThinkingFormat = overlay.ThinkingFormat
	}
	if configFieldWasSet(overlay.fieldSet, "cacheControl") || (overlay.fieldSet == nil && overlay.CacheControl != nil) {
		result.CacheControl = CloneBoolPtr(overlay.CacheControl)
	}
	if configFieldWasSet(overlay.fieldSet, "maxImagesPerRequest") || (overlay.fieldSet == nil && overlay.MaxImagesPerRequest != 0) {
		result.MaxImagesPerRequest = overlay.MaxImagesPerRequest
	}
	if configFieldWasSet(overlay.fieldSet, "headers") || (overlay.fieldSet == nil && len(overlay.Headers) > 0) {
		result.Headers = CloneStringMap(overlay.Headers)
	}
	if configFieldWasSet(overlay.fieldSet, "responses") || responsesConfigHasValues(overlay.Responses) {
		result.Responses = cloneResponsesConfig(overlay.Responses)
	}
	if configFieldWasSet(overlay.fieldSet, "models") || (overlay.fieldSet == nil && len(overlay.Models) > 0) {
		result.Models = mergeModelConfigs(result.Models, overlay.Models)
	}
	return result
}

func responsesConfigHasValues(c ResponsesConfig) bool {
	return c.ReasoningSummary != "" ||
		c.ReasoningContext != "" ||
		c.ReasoningMode != "" ||
		c.PromptCacheEnabled != nil ||
		c.PromptCacheKey != "" ||
		c.PromptCacheRetention != "" ||
		c.PromptCacheMode != "" ||
		c.PromptCacheTTL != "" ||
		c.SafetyIdentifier != "" ||
		len(c.Metadata) > 0 ||
		c.StateMode != "" ||
		c.Store != nil ||
		c.Conversation != "" ||
		c.Truncation != "" ||
		c.Background != nil ||
		len(c.Include) > 0 ||
		c.ServiceTier != "" ||
		c.StructuredOutput.Name != "" ||
		c.StructuredOutput.Description != "" ||
		c.StructuredOutput.Strict != nil ||
		len(c.StructuredOutput.Schema) > 0 ||
		c.ToolControl.Choice != "" ||
		c.ToolControl.Parallel != nil ||
		c.ToolControl.MaxCalls != 0 ||
		len(c.HostedTools.WebSearch) > 0 ||
		len(c.HostedTools.FileSearch) > 0 ||
		len(c.HostedTools.CodeInterpreter) > 0 ||
		len(c.HostedTools.ComputerUse) > 0 ||
		len(c.HostedTools.ImageGeneration) > 0 ||
		len(c.HostedTools.RemoteMCP) > 0
}

// mergeModelConfigs combines built-in and runtime model lists by model ID.
// Runtime entries take precedence for matching IDs; built-in-only entries remain
// available with their complete preset parameters. Runtime order is preserved,
// followed by built-in models that were not configured explicitly.
func mergeModelConfigs(builtin, runtime []ModelConfig) []ModelConfig {
	result := make([]ModelConfig, 0, len(runtime)+len(builtin))
	seen := make(map[string]struct{}, len(runtime)+len(builtin))
	for _, model := range runtime {
		if model.ID == "" {
			continue
		}
		result = append(result, cloneModelConfig(model))
		seen[model.ID] = struct{}{}
	}
	for _, model := range builtin {
		if model.ID == "" {
			continue
		}
		if _, exists := seen[model.ID]; exists {
			continue
		}
		result = append(result, cloneModelConfig(model))
		seen[model.ID] = struct{}{}
	}
	return result
}

// mergeModelConfig overlays non-zero fields from `overlay` onto `base`.
func mergeModelConfig(base, overlay ModelConfig) ModelConfig {
	result := cloneModelConfig(base)
	if configFieldWasSet(overlay.fieldSet, "id") || (overlay.fieldSet == nil && overlay.ID != "") {
		result.ID = overlay.ID
	}
	if configFieldWasSet(overlay.fieldSet, "name") || (overlay.fieldSet == nil && overlay.Name != "") {
		result.Name = overlay.Name
	}
	if configFieldWasSet(overlay.fieldSet, "contextWindow") || (overlay.fieldSet == nil && overlay.ContextWindow > 0) {
		result.ContextWindow = overlay.ContextWindow
	}
	if configFieldWasSet(overlay.fieldSet, "maxTokens") || (overlay.fieldSet == nil && overlay.MaxTokens > 0) {
		result.MaxTokens = overlay.MaxTokens
		result.fieldSet = markConfigField(result.fieldSet, "maxTokens")
	}
	if configFieldWasSet(overlay.fieldSet, "reasoning") || (overlay.fieldSet == nil && overlay.Reasoning) {
		result.Reasoning = overlay.Reasoning
	}
	if configFieldWasSet(overlay.fieldSet, "input") || (overlay.fieldSet == nil && len(overlay.Input) > 0) {
		result.Input = CloneStringSlice(overlay.Input)
	}
	if configFieldWasSet(overlay.fieldSet, "temperature") || (overlay.fieldSet == nil && overlay.Temperature != nil) {
		result.Temperature = CloneFloat64Ptr(overlay.Temperature)
	}
	if configFieldWasSet(overlay.fieldSet, "top_p") || (overlay.fieldSet == nil && overlay.TopP != nil) {
		result.TopP = CloneFloat64Ptr(overlay.TopP)
	}
	if configFieldWasSet(overlay.fieldSet, "cost") || (overlay.fieldSet == nil && overlay.Cost != nil) {
		if overlay.Cost == nil {
			result.Cost = nil
		} else {
			c := *overlay.Cost
			result.Cost = &c
		}
	}
	if configFieldWasSet(overlay.fieldSet, "compat") || (overlay.fieldSet == nil && overlay.Compat != nil) {
		result.Compat = cloneModelCompat(overlay.Compat)
	}
	return result
}
