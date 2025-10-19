package config

import (
	"encoding/json"

	"github.com/cline/grpc-go/cline"
)

// extractSettingsAndSecrets extracts Settings and Secrets from the state JSON
func extractSettingsAndSecrets(stateData map[string]interface{}) (*cline.Settings, *cline.Secrets) {
	settings := &cline.Settings{}
	secrets := &cline.Secrets{}

	// Helper to get string pointer from interface
	getStringPtr := func(val interface{}) *string {
		if val == nil {
			return nil
		}
		if str, ok := val.(string); ok {
			s := str
			return &s
		}
		return nil
	}

	// Helper to get bool pointer from interface
	getBoolPtr := func(val interface{}) *bool {
		if val == nil {
			return nil
		}
		if b, ok := val.(bool); ok {
			bp := b
			return &bp
		}
		return nil
	}

	// Helper to get int32 pointer from interface
	getInt32Ptr := func(val interface{}) *int32 {
		if val == nil {
			return nil
		}
		// JSON numbers come as float64
		if f, ok := val.(float64); ok {
			i := int32(f)
			return &i
		}
		return nil
	}

	// Helper to get int64 pointer from interface
	getInt64Ptr := func(val interface{}) *int64 {
		if val == nil {
			return nil
		}
		// JSON numbers come as float64
		if f, ok := val.(float64); ok {
			i := int64(f)
			return &i
		}
		return nil
	}

	// Helper to get float64 pointer from interface
	getFloat64Ptr := func(val interface{}) *float64 {
		if val == nil {
			return nil
		}
		if f, ok := val.(float64); ok {
			fp := f
			return &fp
		}
		return nil
	}

	// Extract Settings fields
	settings.AwsRegion = getStringPtr(stateData["awsRegion"])
	settings.AwsUseCrossRegionInference = getBoolPtr(stateData["awsUseCrossRegionInference"])
	settings.AwsBedrockUsePromptCache = getBoolPtr(stateData["awsBedrockUsePromptCache"])
	settings.AwsBedrockEndpoint = getStringPtr(stateData["awsBedrockEndpoint"])
	settings.AwsProfile = getStringPtr(stateData["awsProfile"])
	settings.AwsAuthentication = getStringPtr(stateData["awsAuthentication"])
	settings.AwsUseProfile = getBoolPtr(stateData["awsUseProfile"])
	settings.VertexProjectId = getStringPtr(stateData["vertexProjectId"])
	settings.VertexRegion = getStringPtr(stateData["vertexRegion"])
	settings.RequestyBaseUrl = getStringPtr(stateData["requestyBaseUrl"])
	settings.OpenAiBaseUrl = getStringPtr(stateData["openAiBaseUrl"])
	settings.OllamaBaseUrl = getStringPtr(stateData["ollamaBaseUrl"])
	settings.OllamaApiOptionsCtxNum = getStringPtr(stateData["ollamaApiOptionsCtxNum"])
	settings.LmStudioBaseUrl = getStringPtr(stateData["lmStudioBaseUrl"])
	settings.LmStudioMaxTokens = getStringPtr(stateData["lmStudioMaxTokens"])
	settings.AnthropicBaseUrl = getStringPtr(stateData["anthropicBaseUrl"])
	settings.GeminiBaseUrl = getStringPtr(stateData["geminiBaseUrl"])
	settings.AzureApiVersion = getStringPtr(stateData["azureApiVersion"])
	settings.OpenRouterProviderSorting = getStringPtr(stateData["openRouterProviderSorting"])
	settings.LiteLlmBaseUrl = getStringPtr(stateData["liteLlmBaseUrl"])
	settings.LiteLlmUsePromptCache = getBoolPtr(stateData["liteLlmUsePromptCache"])
	settings.FireworksModelMaxCompletionTokens = getInt32Ptr(stateData["fireworksModelMaxCompletionTokens"])
	settings.FireworksModelMaxTokens = getInt32Ptr(stateData["fireworksModelMaxTokens"])
	settings.QwenApiLine = getStringPtr(stateData["qwenApiLine"])
	settings.MoonshotApiLine = getStringPtr(stateData["moonshotApiLine"])
	settings.ZaiApiLine = getStringPtr(stateData["zaiApiLine"])
	settings.TelemetrySetting = getStringPtr(stateData["telemetrySetting"])
	settings.AsksageApiUrl = getStringPtr(stateData["asksageApiUrl"])
	settings.PlanActSeparateModelsSetting = getBoolPtr(stateData["planActSeparateModelsSetting"])
	settings.EnableCheckpointsSetting = getBoolPtr(stateData["enableCheckpointsSetting"])
	settings.RequestTimeoutMs = getInt32Ptr(stateData["requestTimeoutMs"])
	settings.ShellIntegrationTimeout = getInt32Ptr(stateData["shellIntegrationTimeout"])
	settings.DefaultTerminalProfile = getStringPtr(stateData["defaultTerminalProfile"])
	settings.TerminalOutputLineLimit = getInt32Ptr(stateData["terminalOutputLineLimit"])
	settings.SapAiCoreTokenUrl = getStringPtr(stateData["sapAiCoreTokenUrl"])
	settings.SapAiCoreBaseUrl = getStringPtr(stateData["sapAiCoreBaseUrl"])
	settings.SapAiResourceGroup = getStringPtr(stateData["sapAiResourceGroup"])
	settings.SapAiCoreUseOrchestrationMode = getBoolPtr(stateData["sapAiCoreUseOrchestrationMode"])
	settings.ClaudeCodePath = getStringPtr(stateData["claudeCodePath"])
	settings.QwenCodeOauthPath = getStringPtr(stateData["qwenCodeOauthPath"])
	settings.StrictPlanModeEnabled = getBoolPtr(stateData["strictPlanModeEnabled"])
	settings.YoloModeToggled = getBoolPtr(stateData["yoloModeToggled"])
	settings.UseAutoCondense = getBoolPtr(stateData["useAutoCondense"])
	settings.PreferredLanguage = getStringPtr(stateData["preferredLanguage"])
	settings.CustomPrompt = getStringPtr(stateData["customPrompt"])
	settings.DifyBaseUrl = getStringPtr(stateData["difyBaseUrl"])
	settings.AutoCondenseThreshold = getFloat64Ptr(stateData["autoCondenseThreshold"])
	settings.OcaBaseUrl = getStringPtr(stateData["ocaBaseUrl"])
	settings.MaxConsecutiveMistakes = getInt32Ptr(stateData["maxConsecutiveMistakes"])
	settings.PlanModeThinkingBudgetTokens = getInt64Ptr(stateData["planModeThinkingBudgetTokens"])
	settings.ActModeThinkingBudgetTokens = getInt64Ptr(stateData["actModeThinkingBudgetTokens"])

	// Extract AutoApprovalSettings if present
	if autoApprovalData, ok := stateData["autoApprovalSettings"].(map[string]interface{}); ok {
		autoApproval := &cline.AutoApprovalSettings{}
		
		if version, ok := autoApprovalData["version"].(float64); ok {
			autoApproval.Version = int32(version)
		}
		if enabled, ok := autoApprovalData["enabled"].(bool); ok {
			autoApproval.Enabled = enabled
		}
		if maxRequests, ok := autoApprovalData["maxRequests"].(float64); ok {
			autoApproval.MaxRequests = int32(maxRequests)
		}
		if enableNotifications, ok := autoApprovalData["enableNotifications"].(bool); ok {
			autoApproval.EnableNotifications = enableNotifications
		}
		
		// Extract actions if present
		if actionsData, ok := autoApprovalData["actions"].(map[string]interface{}); ok {
			actions := &cline.AutoApprovalActions{}
			actions.ReadFiles = getBoolPtr(actionsData["readFiles"])
			actions.ReadFilesExternally = getBoolPtr(actionsData["readFilesExternally"])
			actions.EditFiles = getBoolPtr(actionsData["editFiles"])
			actions.EditFilesExternally = getBoolPtr(actionsData["editFilesExternally"])
			actions.ExecuteSafeCommands = getBoolPtr(actionsData["executeSafeCommands"])
			actions.ExecuteAllCommands = getBoolPtr(actionsData["executeAllCommands"])
			actions.UseBrowser = getBoolPtr(actionsData["useBrowser"])
			actions.UseMcp = getBoolPtr(actionsData["useMcp"])
			autoApproval.Actions = actions
		}
		
		// Extract favorites if present
		if favoritesData, ok := autoApprovalData["favorites"].([]interface{}); ok {
			favorites := make([]string, 0, len(favoritesData))
			for _, fav := range favoritesData {
				if str, ok := fav.(string); ok {
					favorites = append(favorites, str)
				}
			}
			autoApproval.Favorites = favorites
		}
		
		settings.AutoApprovalSettings = autoApproval
	}

	// Extract BrowserSettings if present
	if browserData, ok := stateData["browserSettings"].(map[string]interface{}); ok {
		browser := &cline.BrowserSettings{}
		
		if viewportData, ok := browserData["viewport"].(map[string]interface{}); ok {
			viewport := &cline.Viewport{}
			if width, ok := viewportData["width"].(float64); ok {
				viewport.Width = int32(width)
			}
			if height, ok := viewportData["height"].(float64); ok {
				viewport.Height = int32(height)
			}
			browser.Viewport = viewport
		}
		
		browser.RemoteBrowserHost = getStringPtr(browserData["remoteBrowserHost"])
		browser.RemoteBrowserEnabled = getBoolPtr(browserData["remoteBrowserEnabled"])
		browser.ChromeExecutablePath = getStringPtr(browserData["chromeExecutablePath"])
		browser.DisableToolUse = getBoolPtr(browserData["disableToolUse"])
		browser.CustomArgs = getStringPtr(browserData["customArgs"])
		
		settings.BrowserSettings = browser
	}

	// Note: We're not extracting all the complex fields like model configurations
	// as they are less likely to be set via CLI. If needed, they can be added here.

	return settings, secrets
}

// mergeSettings merges partial settings into current settings
// Only non-nil fields from partial are merged into current
func mergeSettings(current, partial *cline.Settings) *cline.Settings {
	if partial == nil {
		return current
	}
	if current == nil {
		return partial
	}

	merged := &cline.Settings{}
	
	// Use JSON marshal/unmarshal to create a deep copy of current
	data, _ := json.Marshal(current)
	json.Unmarshal(data, merged)

	// Merge simple fields - only update if partial has a non-nil value
	if partial.AwsRegion != nil {
		merged.AwsRegion = partial.AwsRegion
	}
	if partial.AwsUseCrossRegionInference != nil {
		merged.AwsUseCrossRegionInference = partial.AwsUseCrossRegionInference
	}
	if partial.AwsBedrockUsePromptCache != nil {
		merged.AwsBedrockUsePromptCache = partial.AwsBedrockUsePromptCache
	}
	if partial.AwsBedrockEndpoint != nil {
		merged.AwsBedrockEndpoint = partial.AwsBedrockEndpoint
	}
	if partial.AwsProfile != nil {
		merged.AwsProfile = partial.AwsProfile
	}
	if partial.AwsAuthentication != nil {
		merged.AwsAuthentication = partial.AwsAuthentication
	}
	if partial.AwsUseProfile != nil {
		merged.AwsUseProfile = partial.AwsUseProfile
	}
	if partial.VertexProjectId != nil {
		merged.VertexProjectId = partial.VertexProjectId
	}
	if partial.VertexRegion != nil {
		merged.VertexRegion = partial.VertexRegion
	}
	if partial.RequestyBaseUrl != nil {
		merged.RequestyBaseUrl = partial.RequestyBaseUrl
	}
	if partial.OpenAiBaseUrl != nil {
		merged.OpenAiBaseUrl = partial.OpenAiBaseUrl
	}
	if partial.OllamaBaseUrl != nil {
		merged.OllamaBaseUrl = partial.OllamaBaseUrl
	}
	if partial.OllamaApiOptionsCtxNum != nil {
		merged.OllamaApiOptionsCtxNum = partial.OllamaApiOptionsCtxNum
	}
	if partial.LmStudioBaseUrl != nil {
		merged.LmStudioBaseUrl = partial.LmStudioBaseUrl
	}
	if partial.LmStudioMaxTokens != nil {
		merged.LmStudioMaxTokens = partial.LmStudioMaxTokens
	}
	if partial.AnthropicBaseUrl != nil {
		merged.AnthropicBaseUrl = partial.AnthropicBaseUrl
	}
	if partial.GeminiBaseUrl != nil {
		merged.GeminiBaseUrl = partial.GeminiBaseUrl
	}
	if partial.AzureApiVersion != nil {
		merged.AzureApiVersion = partial.AzureApiVersion
	}
	if partial.OpenRouterProviderSorting != nil {
		merged.OpenRouterProviderSorting = partial.OpenRouterProviderSorting
	}
	if partial.LiteLlmBaseUrl != nil {
		merged.LiteLlmBaseUrl = partial.LiteLlmBaseUrl
	}
	if partial.LiteLlmUsePromptCache != nil {
		merged.LiteLlmUsePromptCache = partial.LiteLlmUsePromptCache
	}
	if partial.FireworksModelMaxCompletionTokens != nil {
		merged.FireworksModelMaxCompletionTokens = partial.FireworksModelMaxCompletionTokens
	}
	if partial.FireworksModelMaxTokens != nil {
		merged.FireworksModelMaxTokens = partial.FireworksModelMaxTokens
	}
	if partial.QwenApiLine != nil {
		merged.QwenApiLine = partial.QwenApiLine
	}
	if partial.MoonshotApiLine != nil {
		merged.MoonshotApiLine = partial.MoonshotApiLine
	}
	if partial.ZaiApiLine != nil {
		merged.ZaiApiLine = partial.ZaiApiLine
	}
	if partial.TelemetrySetting != nil {
		merged.TelemetrySetting = partial.TelemetrySetting
	}
	if partial.AsksageApiUrl != nil {
		merged.AsksageApiUrl = partial.AsksageApiUrl
	}
	if partial.PlanActSeparateModelsSetting != nil {
		merged.PlanActSeparateModelsSetting = partial.PlanActSeparateModelsSetting
	}
	if partial.EnableCheckpointsSetting != nil {
		merged.EnableCheckpointsSetting = partial.EnableCheckpointsSetting
	}
	if partial.RequestTimeoutMs != nil {
		merged.RequestTimeoutMs = partial.RequestTimeoutMs
	}
	if partial.ShellIntegrationTimeout != nil {
		merged.ShellIntegrationTimeout = partial.ShellIntegrationTimeout
	}
	if partial.DefaultTerminalProfile != nil {
		merged.DefaultTerminalProfile = partial.DefaultTerminalProfile
	}
	if partial.TerminalOutputLineLimit != nil {
		merged.TerminalOutputLineLimit = partial.TerminalOutputLineLimit
	}
	if partial.SapAiCoreTokenUrl != nil {
		merged.SapAiCoreTokenUrl = partial.SapAiCoreTokenUrl
	}
	if partial.SapAiCoreBaseUrl != nil {
		merged.SapAiCoreBaseUrl = partial.SapAiCoreBaseUrl
	}
	if partial.SapAiResourceGroup != nil {
		merged.SapAiResourceGroup = partial.SapAiResourceGroup
	}
	if partial.SapAiCoreUseOrchestrationMode != nil {
		merged.SapAiCoreUseOrchestrationMode = partial.SapAiCoreUseOrchestrationMode
	}
	if partial.ClaudeCodePath != nil {
		merged.ClaudeCodePath = partial.ClaudeCodePath
	}
	if partial.QwenCodeOauthPath != nil {
		merged.QwenCodeOauthPath = partial.QwenCodeOauthPath
	}
	if partial.StrictPlanModeEnabled != nil {
		merged.StrictPlanModeEnabled = partial.StrictPlanModeEnabled
	}
	if partial.YoloModeToggled != nil {
		merged.YoloModeToggled = partial.YoloModeToggled
	}
	if partial.UseAutoCondense != nil {
		merged.UseAutoCondense = partial.UseAutoCondense
	}
	if partial.PreferredLanguage != nil {
		merged.PreferredLanguage = partial.PreferredLanguage
	}
	if partial.OpenaiReasoningEffort != nil {
		merged.OpenaiReasoningEffort = partial.OpenaiReasoningEffort
	}
	if partial.Mode != nil {
		merged.Mode = partial.Mode
	}
	if partial.CustomPrompt != nil {
		merged.CustomPrompt = partial.CustomPrompt
	}
	if partial.DifyBaseUrl != nil {
		merged.DifyBaseUrl = partial.DifyBaseUrl
	}
	if partial.AutoCondenseThreshold != nil {
		merged.AutoCondenseThreshold = partial.AutoCondenseThreshold
	}
	if partial.OcaBaseUrl != nil {
		merged.OcaBaseUrl = partial.OcaBaseUrl
	}
	if partial.MaxConsecutiveMistakes != nil {
		merged.MaxConsecutiveMistakes = partial.MaxConsecutiveMistakes
	}

	// Merge AutoApprovalSettings - deep merge
	if partial.AutoApprovalSettings != nil {
		if merged.AutoApprovalSettings == nil {
			merged.AutoApprovalSettings = &cline.AutoApprovalSettings{}
		}
		
		// Only update fields that are explicitly set in partial
		if partial.AutoApprovalSettings.Version != 0 {
			merged.AutoApprovalSettings.Version = partial.AutoApprovalSettings.Version
		}
		// For bool fields, we need to check if they were set (this is tricky with protobuf)
		// We'll merge them if the partial has the field set
		merged.AutoApprovalSettings.Enabled = partial.AutoApprovalSettings.Enabled
		if partial.AutoApprovalSettings.MaxRequests != 0 {
			merged.AutoApprovalSettings.MaxRequests = partial.AutoApprovalSettings.MaxRequests
		}
		merged.AutoApprovalSettings.EnableNotifications = partial.AutoApprovalSettings.EnableNotifications
		
		if partial.AutoApprovalSettings.Favorites != nil {
			merged.AutoApprovalSettings.Favorites = partial.AutoApprovalSettings.Favorites
		}
		
		// Merge actions
		if partial.AutoApprovalSettings.Actions != nil {
			if merged.AutoApprovalSettings.Actions == nil {
				merged.AutoApprovalSettings.Actions = &cline.AutoApprovalActions{}
			}
			
			if partial.AutoApprovalSettings.Actions.ReadFiles != nil {
				merged.AutoApprovalSettings.Actions.ReadFiles = partial.AutoApprovalSettings.Actions.ReadFiles
			}
			if partial.AutoApprovalSettings.Actions.ReadFilesExternally != nil {
				merged.AutoApprovalSettings.Actions.ReadFilesExternally = partial.AutoApprovalSettings.Actions.ReadFilesExternally
			}
			if partial.AutoApprovalSettings.Actions.EditFiles != nil {
				merged.AutoApprovalSettings.Actions.EditFiles = partial.AutoApprovalSettings.Actions.EditFiles
			}
			if partial.AutoApprovalSettings.Actions.EditFilesExternally != nil {
				merged.AutoApprovalSettings.Actions.EditFilesExternally = partial.AutoApprovalSettings.Actions.EditFilesExternally
			}
			if partial.AutoApprovalSettings.Actions.ExecuteSafeCommands != nil {
				merged.AutoApprovalSettings.Actions.ExecuteSafeCommands = partial.AutoApprovalSettings.Actions.ExecuteSafeCommands
			}
			if partial.AutoApprovalSettings.Actions.ExecuteAllCommands != nil {
				merged.AutoApprovalSettings.Actions.ExecuteAllCommands = partial.AutoApprovalSettings.Actions.ExecuteAllCommands
			}
			if partial.AutoApprovalSettings.Actions.UseBrowser != nil {
				merged.AutoApprovalSettings.Actions.UseBrowser = partial.AutoApprovalSettings.Actions.UseBrowser
			}
			if partial.AutoApprovalSettings.Actions.UseMcp != nil {
				merged.AutoApprovalSettings.Actions.UseMcp = partial.AutoApprovalSettings.Actions.UseMcp
			}
		}
	}

	// Merge BrowserSettings - deep merge
	if partial.BrowserSettings != nil {
		if merged.BrowserSettings == nil {
			merged.BrowserSettings = &cline.BrowserSettings{}
		}
		
		if partial.BrowserSettings.Viewport != nil {
			if merged.BrowserSettings.Viewport == nil {
				merged.BrowserSettings.Viewport = &cline.Viewport{}
			}
			if partial.BrowserSettings.Viewport.Width != 0 {
				merged.BrowserSettings.Viewport.Width = partial.BrowserSettings.Viewport.Width
			}
			if partial.BrowserSettings.Viewport.Height != 0 {
				merged.BrowserSettings.Viewport.Height = partial.BrowserSettings.Viewport.Height
			}
		}
		
		if partial.BrowserSettings.RemoteBrowserHost != nil {
			merged.BrowserSettings.RemoteBrowserHost = partial.BrowserSettings.RemoteBrowserHost
		}
		if partial.BrowserSettings.RemoteBrowserEnabled != nil {
			merged.BrowserSettings.RemoteBrowserEnabled = partial.BrowserSettings.RemoteBrowserEnabled
		}
		if partial.BrowserSettings.ChromeExecutablePath != nil {
			merged.BrowserSettings.ChromeExecutablePath = partial.BrowserSettings.ChromeExecutablePath
		}
		if partial.BrowserSettings.DisableToolUse != nil {
			merged.BrowserSettings.DisableToolUse = partial.BrowserSettings.DisableToolUse
		}
		if partial.BrowserSettings.CustomArgs != nil {
			merged.BrowserSettings.CustomArgs = partial.BrowserSettings.CustomArgs
		}
	}

	return merged
}

// mergeSecrets merges partial secrets into current secrets
// Only non-nil fields from partial are merged into current
func mergeSecrets(current, partial *cline.Secrets) *cline.Secrets {
	if partial == nil {
		return current
	}
	if current == nil {
		return partial
	}

	merged := &cline.Secrets{}
	
	// Use JSON marshal/unmarshal to create a deep copy of current
	data, _ := json.Marshal(current)
	json.Unmarshal(data, merged)

	// Merge secret fields - only update if partial has a non-nil value
	if partial.ApiKey != nil {
		merged.ApiKey = partial.ApiKey
	}
	if partial.OpenRouterApiKey != nil {
		merged.OpenRouterApiKey = partial.OpenRouterApiKey
	}
	if partial.AwsAccessKey != nil {
		merged.AwsAccessKey = partial.AwsAccessKey
	}
	if partial.AwsSecretKey != nil {
		merged.AwsSecretKey = partial.AwsSecretKey
	}
	if partial.AwsSessionToken != nil {
		merged.AwsSessionToken = partial.AwsSessionToken
	}
	if partial.AwsBedrockApiKey != nil {
		merged.AwsBedrockApiKey = partial.AwsBedrockApiKey
	}
	if partial.OpenAiApiKey != nil {
		merged.OpenAiApiKey = partial.OpenAiApiKey
	}
	if partial.GeminiApiKey != nil {
		merged.GeminiApiKey = partial.GeminiApiKey
	}
	if partial.OpenAiNativeApiKey != nil {
		merged.OpenAiNativeApiKey = partial.OpenAiNativeApiKey
	}
	if partial.OllamaApiKey != nil {
		merged.OllamaApiKey = partial.OllamaApiKey
	}
	if partial.DeepSeekApiKey != nil {
		merged.DeepSeekApiKey = partial.DeepSeekApiKey
	}
	if partial.RequestyApiKey != nil {
		merged.RequestyApiKey = partial.RequestyApiKey
	}
	if partial.TogetherApiKey != nil {
		merged.TogetherApiKey = partial.TogetherApiKey
	}
	if partial.FireworksApiKey != nil {
		merged.FireworksApiKey = partial.FireworksApiKey
	}
	if partial.QwenApiKey != nil {
		merged.QwenApiKey = partial.QwenApiKey
	}
	if partial.DoubaoApiKey != nil {
		merged.DoubaoApiKey = partial.DoubaoApiKey
	}
	if partial.MistralApiKey != nil {
		merged.MistralApiKey = partial.MistralApiKey
	}
	if partial.LiteLlmApiKey != nil {
		merged.LiteLlmApiKey = partial.LiteLlmApiKey
	}
	if partial.AuthNonce != nil {
		merged.AuthNonce = partial.AuthNonce
	}
	if partial.AsksageApiKey != nil {
		merged.AsksageApiKey = partial.AsksageApiKey
	}
	if partial.XaiApiKey != nil {
		merged.XaiApiKey = partial.XaiApiKey
	}
	if partial.MoonshotApiKey != nil {
		merged.MoonshotApiKey = partial.MoonshotApiKey
	}
	if partial.ZaiApiKey != nil {
		merged.ZaiApiKey = partial.ZaiApiKey
	}
	if partial.HuggingFaceApiKey != nil {
		merged.HuggingFaceApiKey = partial.HuggingFaceApiKey
	}
	if partial.NebiusApiKey != nil {
		merged.NebiusApiKey = partial.NebiusApiKey
	}
	if partial.SambanovaApiKey != nil {
		merged.SambanovaApiKey = partial.SambanovaApiKey
	}
	if partial.CerebrasApiKey != nil {
		merged.CerebrasApiKey = partial.CerebrasApiKey
	}
	if partial.SapAiCoreClientId != nil {
		merged.SapAiCoreClientId = partial.SapAiCoreClientId
	}
	if partial.SapAiCoreClientSecret != nil {
		merged.SapAiCoreClientSecret = partial.SapAiCoreClientSecret
	}
	if partial.GroqApiKey != nil {
		merged.GroqApiKey = partial.GroqApiKey
	}
	if partial.HuaweiCloudMaasApiKey != nil {
		merged.HuaweiCloudMaasApiKey = partial.HuaweiCloudMaasApiKey
	}
	if partial.BasetenApiKey != nil {
		merged.BasetenApiKey = partial.BasetenApiKey
	}
	if partial.VercelAiGatewayApiKey != nil {
		merged.VercelAiGatewayApiKey = partial.VercelAiGatewayApiKey
	}
	if partial.DifyApiKey != nil {
		merged.DifyApiKey = partial.DifyApiKey
	}
	if partial.OcaApiKey != nil {
		merged.OcaApiKey = partial.OcaApiKey
	}
	if partial.OcaRefreshToken != nil {
		merged.OcaRefreshToken = partial.OcaRefreshToken
	}

	return merged
}