package task

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/cline/grpc-go/cline"
)


func ParseTaskSettings(settingsFlags []string) (*cline.Settings, *cline.Secrets, error) {
	if len(settingsFlags) == 0 {
		return nil, nil, nil
	}

	settings := &cline.Settings{}
	secrets := &cline.Secrets{}
	nestedSettings := make(map[string]map[string]string)

	for _, flag := range settingsFlags {
		// Parse key=value
		parts := strings.SplitN(flag, "=", 2)
		if len(parts) != 2 {
			return nil, nil, fmt.Errorf("invalid setting format '%s': expected key=value", flag)
		}

		key := strings.TrimSpace(parts[0])
		value := strings.TrimSpace(parts[1])

		// Convert kebab-case to snake_case
		key = kebabToSnake(key)

		// Check if this is a nested setting (contains a dot)
		if strings.Contains(key, ".") {
			dotParts := strings.SplitN(key, ".", 2)
			parentField := dotParts[0]
			childField := dotParts[1]

			if nestedSettings[parentField] == nil {
				nestedSettings[parentField] = make(map[string]string)
			}
			nestedSettings[parentField][childField] = value
		} else {
			// Check if it's a secret field first, then settings field
			if err := setSecretField(secrets, key, value); err == nil {
				// Successfully set as secret, continue
				continue
			}
			// Not a secret, try as a settings field
			if err := setSimpleField(settings, key, value); err != nil {
				return nil, nil, fmt.Errorf("error setting field '%s': %w", key, err)
			}
		}
	}

	// Process nested settings
	for parentField, childFields := range nestedSettings {
		if err := setNestedField(settings, parentField, childFields); err != nil {
			return nil, nil, fmt.Errorf("error setting nested field '%s': %w", parentField, err)
		}
	}

	return settings, secrets, nil
}

// kebabToSnake converts kebab-case to snake_case
func kebabToSnake(s string) string {
	return strings.ReplaceAll(s, "-", "_")
}

// Pointer helper functions for optional protobuf fields
func strPtr(s string) *string       { return &s }
func boolPtr(b bool) *bool          { return &b }
func int32Ptr(i int32) *int32       { return &i }
func int64Ptr(i int64) *int64       { return &i }
func float64Ptr(f float64) *float64 { return &f }

// setSimpleField sets a simple (non-nested) field on Settings
func setSimpleField(settings *cline.Settings, key, value string) error {
	switch key {
	// String fields
	case "aws_region":
		settings.AwsRegion = strPtr(value)
	case "aws_bedrock_endpoint":
		settings.AwsBedrockEndpoint = strPtr(value)
	case "aws_profile":
		settings.AwsProfile = strPtr(value)
	case "aws_authentication":
		settings.AwsAuthentication = strPtr(value)
	case "vertex_project_id":
		settings.VertexProjectId = strPtr(value)
	case "vertex_region":
		settings.VertexRegion = strPtr(value)
	case "requesty_base_url":
		settings.RequestyBaseUrl = strPtr(value)
	case "open_ai_base_url":
		settings.OpenAiBaseUrl = strPtr(value)
	case "ollama_base_url":
		settings.OllamaBaseUrl = strPtr(value)
	case "ollama_api_options_ctx_num":
		settings.OllamaApiOptionsCtxNum = strPtr(value)
	case "lm_studio_base_url":
		settings.LmStudioBaseUrl = strPtr(value)
	case "lm_studio_max_tokens":
		settings.LmStudioMaxTokens = strPtr(value)
	case "anthropic_base_url":
		settings.AnthropicBaseUrl = strPtr(value)
	case "gemini_base_url":
		settings.GeminiBaseUrl = strPtr(value)
	case "azure_api_version":
		settings.AzureApiVersion = strPtr(value)
	case "open_router_provider_sorting":
		settings.OpenRouterProviderSorting = strPtr(value)
	case "lite_llm_base_url":
		settings.LiteLlmBaseUrl = strPtr(value)
	case "qwen_api_line":
		settings.QwenApiLine = strPtr(value)
	case "moonshot_api_line":
		settings.MoonshotApiLine = strPtr(value)
	case "zai_api_line":
		settings.ZaiApiLine = strPtr(value)
	case "telemetry_setting":
		settings.TelemetrySetting = strPtr(value)
	case "asksage_api_url":
		settings.AsksageApiUrl = strPtr(value)
	case "default_terminal_profile":
		settings.DefaultTerminalProfile = strPtr(value)
	case "sap_ai_core_token_url":
		settings.SapAiCoreTokenUrl = strPtr(value)
	case "sap_ai_core_base_url":
		settings.SapAiCoreBaseUrl = strPtr(value)
	case "sap_ai_resource_group":
		settings.SapAiResourceGroup = strPtr(value)
	case "claude_code_path":
		settings.ClaudeCodePath = strPtr(value)
	case "qwen_code_oauth_path":
		settings.QwenCodeOauthPath = strPtr(value)
	case "preferred_language":
		settings.PreferredLanguage = strPtr(value)
	case "custom_prompt":
		settings.CustomPrompt = strPtr(value)
	case "dify_base_url":
		settings.DifyBaseUrl = strPtr(value)
	case "oca_base_url":
		settings.OcaBaseUrl = strPtr(value)
	case "plan_mode_api_model_id":
		settings.PlanModeApiModelId = strPtr(value)
	case "plan_mode_reasoning_effort":
		settings.PlanModeReasoningEffort = strPtr(value)
	case "plan_mode_aws_bedrock_custom_model_base_id":
		settings.PlanModeAwsBedrockCustomModelBaseId = strPtr(value)
	case "plan_mode_open_router_model_id":
		settings.PlanModeOpenRouterModelId = strPtr(value)
	case "plan_mode_open_ai_model_id":
		settings.PlanModeOpenAiModelId = strPtr(value)
	case "plan_mode_ollama_model_id":
		settings.PlanModeOllamaModelId = strPtr(value)
	case "plan_mode_lm_studio_model_id":
		settings.PlanModeLmStudioModelId = strPtr(value)
	case "plan_mode_lite_llm_model_id":
		settings.PlanModeLiteLlmModelId = strPtr(value)
	case "plan_mode_requesty_model_id":
		settings.PlanModeRequestyModelId = strPtr(value)
	case "plan_mode_together_model_id":
		settings.PlanModeTogetherModelId = strPtr(value)
	case "plan_mode_fireworks_model_id":
		settings.PlanModeFireworksModelId = strPtr(value)
	case "plan_mode_sap_ai_core_model_id":
		settings.PlanModeSapAiCoreModelId = strPtr(value)
	case "plan_mode_sap_ai_core_deployment_id":
		settings.PlanModeSapAiCoreDeploymentId = strPtr(value)
	case "plan_mode_groq_model_id":
		settings.PlanModeGroqModelId = strPtr(value)
	case "plan_mode_baseten_model_id":
		settings.PlanModeBasetenModelId = strPtr(value)
	case "plan_mode_hugging_face_model_id":
		settings.PlanModeHuggingFaceModelId = strPtr(value)
	case "plan_mode_huawei_cloud_maas_model_id":
		settings.PlanModeHuaweiCloudMaasModelId = strPtr(value)
	case "plan_mode_oca_model_id":
		settings.PlanModeOcaModelId = strPtr(value)
	case "act_mode_api_model_id":
		settings.ActModeApiModelId = strPtr(value)
	case "act_mode_reasoning_effort":
		settings.ActModeReasoningEffort = strPtr(value)
	case "act_mode_aws_bedrock_custom_model_base_id":
		settings.ActModeAwsBedrockCustomModelBaseId = strPtr(value)
	case "act_mode_open_router_model_id":
		settings.ActModeOpenRouterModelId = strPtr(value)
	case "act_mode_open_ai_model_id":
		settings.ActModeOpenAiModelId = strPtr(value)
	case "act_mode_ollama_model_id":
		settings.ActModeOllamaModelId = strPtr(value)
	case "act_mode_lm_studio_model_id":
		settings.ActModeLmStudioModelId = strPtr(value)
	case "act_mode_lite_llm_model_id":
		settings.ActModeLiteLlmModelId = strPtr(value)
	case "act_mode_requesty_model_id":
		settings.ActModeRequestyModelId = strPtr(value)
	case "act_mode_together_model_id":
		settings.ActModeTogetherModelId = strPtr(value)
	case "act_mode_fireworks_model_id":
		settings.ActModeFireworksModelId = strPtr(value)
	case "act_mode_sap_ai_core_model_id":
		settings.ActModeSapAiCoreModelId = strPtr(value)
	case "act_mode_sap_ai_core_deployment_id":
		settings.ActModeSapAiCoreDeploymentId = strPtr(value)
	case "act_mode_groq_model_id":
		settings.ActModeGroqModelId = strPtr(value)
	case "act_mode_baseten_model_id":
		settings.ActModeBasetenModelId = strPtr(value)
	case "act_mode_hugging_face_model_id":
		settings.ActModeHuggingFaceModelId = strPtr(value)
	case "act_mode_huawei_cloud_maas_model_id":
		settings.ActModeHuaweiCloudMaasModelId = strPtr(value)
	case "act_mode_oca_model_id":
		settings.ActModeOcaModelId = strPtr(value)

	// Boolean fields
	case "aws_use_cross_region_inference":
		val, err := parseBool(value)
		if err != nil {
			return err
		}
		settings.AwsUseCrossRegionInference = boolPtr(val)
	case "aws_bedrock_use_prompt_cache":
		val, err := parseBool(value)
		if err != nil {
			return err
		}
		settings.AwsBedrockUsePromptCache = boolPtr(val)
	case "aws_use_profile":
		val, err := parseBool(value)
		if err != nil {
			return err
		}
		settings.AwsUseProfile = boolPtr(val)
	case "lite_llm_use_prompt_cache":
		val, err := parseBool(value)
		if err != nil {
			return err
		}
		settings.LiteLlmUsePromptCache = boolPtr(val)
	case "plan_act_separate_models_setting":
		val, err := parseBool(value)
		if err != nil {
			return err
		}
		settings.PlanActSeparateModelsSetting = boolPtr(val)
	case "enable_checkpoints_setting":
		val, err := parseBool(value)
		if err != nil {
			return err
		}
		settings.EnableCheckpointsSetting = boolPtr(val)
	case "sap_ai_core_use_orchestration_mode":
		val, err := parseBool(value)
		if err != nil {
			return err
		}
		settings.SapAiCoreUseOrchestrationMode = boolPtr(val)
	case "strict_plan_mode_enabled":
		val, err := parseBool(value)
		if err != nil {
			return err
		}
		settings.StrictPlanModeEnabled = boolPtr(val)
	case "yolo_mode_toggled":
		val, err := parseBool(value)
		if err != nil {
			return err
		}
		settings.YoloModeToggled = boolPtr(val)
	case "use_auto_condense":
		val, err := parseBool(value)
		if err != nil {
			return err
		}
		settings.UseAutoCondense = boolPtr(val)
	case "plan_mode_aws_bedrock_custom_selected":
		val, err := parseBool(value)
		if err != nil {
			return err
		}
		settings.PlanModeAwsBedrockCustomSelected = boolPtr(val)
	case "act_mode_aws_bedrock_custom_selected":
		val, err := parseBool(value)
		if err != nil {
			return err
		}
		settings.ActModeAwsBedrockCustomSelected = boolPtr(val)
	case "hooks_enabled":
		val, err := parseBool(value)
		if err != nil {
			return err
		}
		settings.HooksEnabled = boolPtr(val)
	case "azure_identity":
		val, err := parseBool(value)
		if err != nil {
			return err
		}
		settings.AzureIdentity = boolPtr(val)

	// Integer fields
	case "request_timeout_ms":
		val, err := parseInt32(value)
		if err != nil {
			return err
		}
		settings.RequestTimeoutMs = int32Ptr(val)
	case "shell_integration_timeout":
		val, err := parseInt32(value)
		if err != nil {
			return err
		}
		settings.ShellIntegrationTimeout = int32Ptr(val)
	case "terminal_output_line_limit":
		val, err := parseInt32(value)
		if err != nil {
			return err
		}
		settings.TerminalOutputLineLimit = int32Ptr(val)
	case "max_consecutive_mistakes":
		val, err := parseInt32(value)
		if err != nil {
			return err
		}
		settings.MaxConsecutiveMistakes = int32Ptr(val)
	case "fireworks_model_max_completion_tokens":
		val, err := parseInt32(value)
		if err != nil {
			return err
		}
		settings.FireworksModelMaxCompletionTokens = int32Ptr(val)
	case "fireworks_model_max_tokens":
		val, err := parseInt32(value)
		if err != nil {
			return err
		}
		settings.FireworksModelMaxTokens = int32Ptr(val)

	// Int64 fields
	case "plan_mode_thinking_budget_tokens":
		val, err := parseInt64(value)
		if err != nil {
			return err
		}
		settings.PlanModeThinkingBudgetTokens = int64Ptr(val)
	case "act_mode_thinking_budget_tokens":
		val, err := parseInt64(value)
		if err != nil {
			return err
		}
		settings.ActModeThinkingBudgetTokens = int64Ptr(val)

	// Double fields
	case "auto_condense_threshold":
		val, err := parseFloat64(value)
		if err != nil {
			return err
		}
		settings.AutoCondenseThreshold = float64Ptr(val)

	// Enum fields
	// Note: We can use &val directly for enums because the parser functions return a new local variable.
	// This is different from using &value (the loop variable), which would cause all fields to share
	// the same memory address.
	case "openai_reasoning_effort":
		val, err := parseOpenaiReasoningEffort(value)
		if err != nil {
			return err
		}
		settings.OpenaiReasoningEffort = &val
	case "mode":
		val, err := parsePlanActMode(value)
		if err != nil {
			return err
		}
		settings.Mode = &val
	case "plan_mode_api_provider":
		val, err := parseApiProvider(value)
		if err != nil {
			return err
		}
		settings.PlanModeApiProvider = &val
	case "act_mode_api_provider":
		val, err := parseApiProvider(value)
		if err != nil {
			return err
		}
		settings.ActModeApiProvider = &val

	default:
		return fmt.Errorf("unsupported field '%s'", key)
	}

	return nil
}

// setNestedField sets a nested field on Settings
// Currently supports: auto_approval_settings, browser_settings
func setNestedField(settings *cline.Settings, parentField string, childFields map[string]string) error {
	switch parentField {
	case "auto_approval_settings":
		if settings.AutoApprovalSettings == nil {
			settings.AutoApprovalSettings = &cline.AutoApprovalSettings{}
		}
		return setAutoApprovalSettings(settings.AutoApprovalSettings, childFields)

	case "browser_settings":
		if settings.BrowserSettings == nil {
			settings.BrowserSettings = &cline.BrowserSettings{}
		}
		return setBrowserSettings(settings.BrowserSettings, childFields)

	default:
		return fmt.Errorf("unsupported nested field '%s' (complex nested types are not supported via -s flags)", parentField)
	}
}

// setAutoApprovalSettings sets fields on AutoApprovalSettings
func setAutoApprovalSettings(settings *cline.AutoApprovalSettings, fields map[string]string) error {
	for key, value := range fields {
		switch key {
		case "enable_notifications":
			val, err := parseBool(value)
			if err != nil {
				return err
			}
			settings.EnableNotifications = boolPtr(val)
		case "actions":
			return fmt.Errorf("auto_approval_settings.actions requires nested dot notation (e.g., auto-approval-settings.actions.read-files=true)")
		default:
			// Check if this is an action field (actions.*)
			if strings.HasPrefix(key, "actions.") {
				actionField := strings.TrimPrefix(key, "actions.")
				if settings.Actions == nil {
					settings.Actions = &cline.AutoApprovalActions{}
				}
				if err := setAutoApprovalAction(settings.Actions, actionField, value); err != nil {
					return err
				}
				// Continue processing other fields
			} else {
				return fmt.Errorf("unsupported auto_approval_settings field '%s'", key)
			}
		}
	}
	return nil
}

// setAutoApprovalAction sets fields on AutoApprovalActions
func setAutoApprovalAction(actions *cline.AutoApprovalActions, key, value string) error {
	val, err := parseBool(value)
	if err != nil {
		return err
	}

	switch key {
	case "read_files":
		actions.ReadFiles = boolPtr(val)
	case "read_files_externally":
		actions.ReadFilesExternally = boolPtr(val)
	case "edit_files":
		actions.EditFiles = boolPtr(val)
	case "edit_files_externally":
		actions.EditFilesExternally = boolPtr(val)
	case "execute_safe_commands":
		actions.ExecuteSafeCommands = boolPtr(val)
	case "execute_all_commands":
		actions.ExecuteAllCommands = boolPtr(val)
	case "use_browser":
		actions.UseBrowser = boolPtr(val)
	case "use_mcp":
		actions.UseMcp = boolPtr(val)
	default:
		return fmt.Errorf("unsupported auto_approval_actions field '%s'", key)
	}

	return nil
}

// setBrowserSettings sets fields on BrowserSettings
func setBrowserSettings(settings *cline.BrowserSettings, fields map[string]string) error {
	for key, value := range fields {
		switch key {
		case "viewport_width":
			val, err := parseInt32(value)
			if err != nil {
				return err
			}
			if settings.Viewport == nil {
				settings.Viewport = &cline.Viewport{}
			}
			settings.Viewport.Width = val
		case "viewport_height":
			val, err := parseInt32(value)
			if err != nil {
				return err
			}
			if settings.Viewport == nil {
				settings.Viewport = &cline.Viewport{}
			}
			settings.Viewport.Height = val
		case "remote_browser_host":
			settings.RemoteBrowserHost = strPtr(value)
		case "remote_browser_enabled":
			val, err := parseBool(value)
			if err != nil {
				return err
			}
			settings.RemoteBrowserEnabled = boolPtr(val)
		case "chrome_executable_path":
			settings.ChromeExecutablePath = strPtr(value)
		case "disable_tool_use":
			val, err := parseBool(value)
			if err != nil {
				return err
			}
			settings.DisableToolUse = boolPtr(val)
		case "custom_args":
			settings.CustomArgs = strPtr(value)
		default:
			return fmt.Errorf("unsupported browser_settings field '%s'", key)
		}
	}
	return nil
}

// Type parsing helpers
func parseBool(value string) (bool, error) {
	lower := strings.ToLower(value)
	switch lower {
	case "true", "t", "yes", "y", "1":
		return true, nil
	case "false", "f", "no", "n", "0":
		return false, nil
	default:
		return false, fmt.Errorf("invalid boolean value '%s': expected true/false", value)
	}
}

func parseInt32(value string) (int32, error) {
	val, err := strconv.ParseInt(value, 10, 32)
	if err != nil {
		return 0, fmt.Errorf("invalid integer value '%s': %w", value, err)
	}
	return int32(val), nil
}

func parseInt64(value string) (int64, error) {
	val, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid integer value '%s': %w", value, err)
	}
	return val, nil
}

func parseFloat64(value string) (float64, error) {
	val, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid float value '%s': %w", value, err)
	}
	return val, nil
}

// Enum parsing helpers
func parseOpenaiReasoningEffort(value string) (cline.OpenaiReasoningEffort, error) {
	lower := strings.ToLower(value)
	switch lower {
	case "low":
		return cline.OpenaiReasoningEffort_LOW, nil
	case "medium":
		return cline.OpenaiReasoningEffort_MEDIUM, nil
	case "high":
		return cline.OpenaiReasoningEffort_HIGH, nil
	default:
		return cline.OpenaiReasoningEffort_LOW, fmt.Errorf("invalid openai_reasoning_effort '%s': expected low/medium/high", value)
	}
}

func parsePlanActMode(value string) (cline.PlanActMode, error) {
	lower := strings.ToLower(value)
	switch lower {
	case "plan":
		return cline.PlanActMode_PLAN, nil
	case "act":
		return cline.PlanActMode_ACT, nil
	default:
		return cline.PlanActMode_ACT, fmt.Errorf("invalid mode '%s': expected plan/act", value)
	}
}

func parseApiProvider(value string) (cline.ApiProvider, error) {
	lower := strings.ToLower(value)
	switch lower {
	case "anthropic":
		return cline.ApiProvider_ANTHROPIC, nil
	case "openrouter":
		return cline.ApiProvider_OPENROUTER, nil
	case "bedrock":
		return cline.ApiProvider_BEDROCK, nil
	case "vertex":
		return cline.ApiProvider_VERTEX, nil
	case "openai":
		return cline.ApiProvider_OPENAI, nil
	case "ollama":
		return cline.ApiProvider_OLLAMA, nil
	case "lmstudio":
		return cline.ApiProvider_LMSTUDIO, nil
	case "gemini":
		return cline.ApiProvider_GEMINI, nil
	case "openai_native":
		return cline.ApiProvider_OPENAI_NATIVE, nil
	case "requesty":
		return cline.ApiProvider_REQUESTY, nil
	case "together":
		return cline.ApiProvider_TOGETHER, nil
	case "deepseek":
		return cline.ApiProvider_DEEPSEEK, nil
	case "qwen":
		return cline.ApiProvider_QWEN, nil
	case "doubao":
		return cline.ApiProvider_DOUBAO, nil
	case "mistral":
		return cline.ApiProvider_MISTRAL, nil
	case "vscode_lm":
		return cline.ApiProvider_VSCODE_LM, nil
	case "cline":
		return cline.ApiProvider_CLINE, nil
	case "litellm":
		return cline.ApiProvider_LITELLM, nil
	case "nebius":
		return cline.ApiProvider_NEBIUS, nil
	case "fireworks":
		return cline.ApiProvider_FIREWORKS, nil
	case "asksage":
		return cline.ApiProvider_ASKSAGE, nil
	case "xai", "grok":
		return cline.ApiProvider_XAI, nil
	case "sambanova":
		return cline.ApiProvider_SAMBANOVA, nil
	case "cerebras":
		return cline.ApiProvider_CEREBRAS, nil
	case "groq":
		return cline.ApiProvider_GROQ, nil
	case "sapaicore", "sap_ai_core":
		return cline.ApiProvider_SAPAICORE, nil
	case "claude_code":
		return cline.ApiProvider_CLAUDE_CODE, nil
	case "moonshot":
		return cline.ApiProvider_MOONSHOT, nil
	case "huggingface":
		return cline.ApiProvider_HUGGINGFACE, nil
	case "huawei_cloud_maas":
		return cline.ApiProvider_HUAWEI_CLOUD_MAAS, nil
	case "baseten":
		return cline.ApiProvider_BASETEN, nil
	case "zai":
		return cline.ApiProvider_ZAI, nil
	case "vercel_ai_gateway":
		return cline.ApiProvider_VERCEL_AI_GATEWAY, nil
	case "qwen_code":
		return cline.ApiProvider_QWEN_CODE, nil
	case "dify":
		return cline.ApiProvider_DIFY, nil
	case "oca":
		return cline.ApiProvider_OCA, nil
	case "minimax":
		return cline.ApiProvider_MINIMAX, nil
	default:
		return cline.ApiProvider_ANTHROPIC, fmt.Errorf("invalid api_provider '%s'", value)
	}
}

// setSecretField sets a secret field on Secrets
// All secret fields are optional strings
// Returns nil if field was successfully set, error otherwise
func setSecretField(secrets *cline.Secrets, key, value string) error {
	switch key {
	case "api_key":
		secrets.ApiKey = strPtr(value)
	case "open_router_api_key":
		secrets.OpenRouterApiKey = strPtr(value)
	case "aws_access_key":
		secrets.AwsAccessKey = strPtr(value)
	case "aws_secret_key":
		secrets.AwsSecretKey = strPtr(value)
	case "aws_session_token":
		secrets.AwsSessionToken = strPtr(value)
	case "aws_bedrock_api_key":
		secrets.AwsBedrockApiKey = strPtr(value)
	case "open_ai_api_key":
		secrets.OpenAiApiKey = strPtr(value)
	case "gemini_api_key":
		secrets.GeminiApiKey = strPtr(value)
	case "open_ai_native_api_key":
		secrets.OpenAiNativeApiKey = strPtr(value)
	case "ollama_api_key":
		secrets.OllamaApiKey = strPtr(value)
	case "deep_seek_api_key":
		secrets.DeepSeekApiKey = strPtr(value)
	case "requesty_api_key":
		secrets.RequestyApiKey = strPtr(value)
	case "together_api_key":
		secrets.TogetherApiKey = strPtr(value)
	case "fireworks_api_key":
		secrets.FireworksApiKey = strPtr(value)
	case "qwen_api_key":
		secrets.QwenApiKey = strPtr(value)
	case "doubao_api_key":
		secrets.DoubaoApiKey = strPtr(value)
	case "mistral_api_key":
		secrets.MistralApiKey = strPtr(value)
	case "lite_llm_api_key":
		secrets.LiteLlmApiKey = strPtr(value)
	case "auth_nonce":
		secrets.AuthNonce = strPtr(value)
	case "asksage_api_key":
		secrets.AsksageApiKey = strPtr(value)
	case "xai_api_key":
		secrets.XaiApiKey = strPtr(value)
	case "moonshot_api_key":
		secrets.MoonshotApiKey = strPtr(value)
	case "zai_api_key":
		secrets.ZaiApiKey = strPtr(value)
	case "hugging_face_api_key":
		secrets.HuggingFaceApiKey = strPtr(value)
	case "nebius_api_key":
		secrets.NebiusApiKey = strPtr(value)
	case "sambanova_api_key":
		secrets.SambanovaApiKey = strPtr(value)
	case "cerebras_api_key":
		secrets.CerebrasApiKey = strPtr(value)
	case "sap_ai_core_client_id":
		secrets.SapAiCoreClientId = strPtr(value)
	case "sap_ai_core_client_secret":
		secrets.SapAiCoreClientSecret = strPtr(value)
	case "groq_api_key":
		secrets.GroqApiKey = strPtr(value)
	case "huawei_cloud_maas_api_key":
		secrets.HuaweiCloudMaasApiKey = strPtr(value)
	case "baseten_api_key":
		secrets.BasetenApiKey = strPtr(value)
	case "dify_api_key":
		secrets.DifyApiKey = strPtr(value)
	case "oca_api_key":
		secrets.OcaApiKey = strPtr(value)
	case "oca_refresh_token":
		secrets.OcaRefreshToken = strPtr(value)
	case "hicap_api_key":
		secrets.HicapApiKey = strPtr(value)
	default:
		return fmt.Errorf("unsupported secret field '%s'", key)
	}

	return nil
}

// Note: message types not supported via -s flags:
// - OpenRouterModelInfo, OpenAiCompatibleModelInfo, LiteLLMModelInfo, OcaModelInfo
// - LanguageModelChatSelector
// - DictationSettings
// - FocusChainSettings
