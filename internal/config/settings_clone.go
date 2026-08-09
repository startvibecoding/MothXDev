package config

import "encoding/json"

func cloneProviderConfigs(src map[string]*ProviderConfig) map[string]*ProviderConfig {
	out := make(map[string]*ProviderConfig, len(src))
	for name, pc := range src {
		out[name] = cloneProviderConfig(pc)
	}
	return out
}

func cloneProviderConfig(src *ProviderConfig) *ProviderConfig {
	if src == nil {
		return nil
	}
	dst := *src
	dst.Headers = CloneStringMap(src.Headers)
	dst.CacheControl = CloneBoolPtr(src.CacheControl)
	dst.Responses = cloneResponsesConfig(src.Responses)
	dst.Models = cloneModelConfigs(src.Models)
	dst.fieldSet = cloneFieldSet(src.fieldSet)
	return &dst
}

func cloneResponsesConfig(src ResponsesConfig) ResponsesConfig {
	src.Metadata = CloneStringMap(src.Metadata)
	src.PromptCacheEnabled = CloneBoolPtr(src.PromptCacheEnabled)
	src.Store = CloneBoolPtr(src.Store)
	src.Background = CloneBoolPtr(src.Background)
	src.Include = CloneStringSlice(src.Include)
	src.StructuredOutput.Strict = CloneBoolPtr(src.StructuredOutput.Strict)
	src.StructuredOutput.Schema = cloneRawMessage(src.StructuredOutput.Schema)
	src.ToolControl.Parallel = CloneBoolPtr(src.ToolControl.Parallel)
	src.HostedTools.WebSearch = cloneAnyMap(src.HostedTools.WebSearch)
	src.HostedTools.FileSearch = cloneAnyMap(src.HostedTools.FileSearch)
	src.HostedTools.CodeInterpreter = cloneAnyMap(src.HostedTools.CodeInterpreter)
	src.HostedTools.ComputerUse = cloneAnyMap(src.HostedTools.ComputerUse)
	src.HostedTools.ImageGeneration = cloneAnyMap(src.HostedTools.ImageGeneration)
	src.HostedTools.RemoteMCP = cloneAnyMapSlice(src.HostedTools.RemoteMCP)
	return src
}

func cloneRawMessage(src json.RawMessage) json.RawMessage {
	if src == nil {
		return nil
	}
	dst := make(json.RawMessage, len(src))
	copy(dst, src)
	return dst
}

func cloneAnyMap(src map[string]any) map[string]any {
	if src == nil {
		return nil
	}
	data, err := json.Marshal(src)
	if err != nil {
		return nil
	}
	var dst map[string]any
	if err := json.Unmarshal(data, &dst); err != nil {
		return nil
	}
	return dst
}

func cloneAnyMapSlice(src []map[string]any) []map[string]any {
	if src == nil {
		return nil
	}
	dst := make([]map[string]any, len(src))
	for i := range src {
		dst[i] = cloneAnyMap(src[i])
	}
	return dst
}

func cloneModelConfigs(src []ModelConfig) []ModelConfig {
	if src == nil {
		return nil
	}
	out := make([]ModelConfig, len(src))
	for i, model := range src {
		out[i] = cloneModelConfig(model)
	}
	return out
}

func cloneModelConfig(src ModelConfig) ModelConfig {
	src.Temperature = CloneFloat64Ptr(src.Temperature)
	src.TopP = CloneFloat64Ptr(src.TopP)
	if src.Cost != nil {
		cost := *src.Cost
		src.Cost = &cost
	}
	src.Input = CloneStringSlice(src.Input)
	src.Compat = cloneModelCompat(src.Compat)
	src.fieldSet = cloneFieldSet(src.fieldSet)
	return src
}

func cloneFieldSet(src map[string]bool) map[string]bool {
	if src == nil {
		return nil
	}
	dst := make(map[string]bool, len(src))
	for k, v := range src {
		dst[k] = v
	}
	return dst
}

func cloneModelCompat(src *ModelCompat) *ModelCompat {
	if src == nil {
		return nil
	}
	dst := *src
	dst.SupportsDeveloperRole = CloneBoolPtr(src.SupportsDeveloperRole)
	dst.SupportsStore = CloneBoolPtr(src.SupportsStore)
	dst.SupportsReasoningEffort = CloneBoolPtr(src.SupportsReasoningEffort)
	dst.SupportsStrictMode = CloneBoolPtr(src.SupportsStrictMode)
	dst.SupportsCacheControlOnTools = CloneBoolPtr(src.SupportsCacheControlOnTools)
	dst.SupportsLongCacheRetention = CloneBoolPtr(src.SupportsLongCacheRetention)
	dst.SupportsPromptCacheKey = CloneBoolPtr(src.SupportsPromptCacheKey)
	dst.SupportsReasoningSummary = CloneBoolPtr(src.SupportsReasoningSummary)
	dst.SupportsEagerToolInputStreaming = CloneBoolPtr(src.SupportsEagerToolInputStreaming)
	dst.DisableSamplingParams = CloneBoolPtr(src.DisableSamplingParams)
	return &dst
}

// CloneStringMap returns a deep copy of a string map, or nil if src is nil.
func CloneStringMap(src map[string]string) map[string]string {
	if src == nil {
		return nil
	}
	out := make(map[string]string, len(src))
	for k, v := range src {
		out[k] = v
	}
	return out
}

// CloneStringSlice returns a deep copy of a string slice, or nil if src is nil.
func CloneStringSlice(src []string) []string {
	if src == nil {
		return nil
	}
	out := make([]string, len(src))
	copy(out, src)
	return out
}

// CloneBoolPtr returns a deep copy of a bool pointer, or nil if src is nil.
func CloneBoolPtr(src *bool) *bool {
	if src == nil {
		return nil
	}
	v := *src
	return &v
}

// CloneFloat64Ptr returns a deep copy of a float64 pointer, or nil if src is nil.
func CloneFloat64Ptr(src *float64) *float64 {
	if src == nil {
		return nil
	}
	v := *src
	return &v
}

// NormalizeSamplingPtr returns nil if src points to zero; otherwise returns a clone of src.
// This prevents zero-valued temperature/top_p from being serialized to API requests,
// which some providers reject.
func NormalizeSamplingPtr(src *float64) *float64 {
	if src == nil {
		return nil
	}
	if *src == 0 {
		return nil
	}
	return CloneFloat64Ptr(src)
}

func boolPtr(v bool) *bool {
	return &v
}
