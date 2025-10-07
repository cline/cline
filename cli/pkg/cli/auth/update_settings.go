package auth

import (
	"context"
	"fmt"

	"github.com/cline/cli/pkg/cli/task"
	"github.com/cline/grpc-go/cline"
	"google.golang.org/protobuf/proto"
)

// ProviderConfig holds the configuration for a single API provider
type ProviderConfig struct {
	Provider cline.ApiProvider
	ModelID  string
	APIKey   string
}

// BuildProviderUpdateRequest constructs a protobuf UpdateSettingsRequest from provider configuration
func BuildProviderUpdateRequest(config ProviderConfig) (*cline.UpdateSettingsRequest, error) {
	apiConfig := &cline.ApiConfiguration{}

	// Set provider-specific fields based on the selected provider
	// TODO - clean this up with better abstractions before more providers are added
	switch config.Provider {
	case cline.ApiProvider_ANTHROPIC:
		apiConfig.ApiKey = proto.String(config.APIKey)
		apiConfig.PlanModeApiProvider = &config.Provider
		apiConfig.PlanModeApiModelId = proto.String(config.ModelID)
		apiConfig.ActModeApiProvider = &config.Provider
		apiConfig.ActModeApiModelId = proto.String(config.ModelID)

	case cline.ApiProvider_OPENAI:
		apiConfig.OpenAiApiKey = proto.String(config.APIKey)
		apiConfig.PlanModeApiProvider = &config.Provider
		apiConfig.PlanModeOpenAiModelId = proto.String(config.ModelID)
		apiConfig.ActModeApiProvider = &config.Provider
		apiConfig.ActModeOpenAiModelId = proto.String(config.ModelID)

	case cline.ApiProvider_OPENAI_NATIVE:
		apiConfig.OpenAiNativeApiKey = proto.String(config.APIKey)
		apiConfig.PlanModeApiProvider = &config.Provider
		apiConfig.PlanModeApiModelId = proto.String(config.ModelID)
		apiConfig.ActModeApiProvider = &config.Provider
		apiConfig.ActModeApiModelId = proto.String(config.ModelID)

	case cline.ApiProvider_OPENROUTER:
		apiConfig.OpenRouterApiKey = proto.String(config.APIKey)
		apiConfig.PlanModeApiProvider = &config.Provider
		apiConfig.PlanModeOpenRouterModelId = proto.String(config.ModelID)
		apiConfig.PlanModeApiModelId = proto.String(config.ModelID)
		apiConfig.ActModeApiProvider = &config.Provider
		apiConfig.ActModeOpenRouterModelId = proto.String(config.ModelID)
		apiConfig.ActModeApiModelId = proto.String(config.ModelID)

	case cline.ApiProvider_XAI:
		apiConfig.XaiApiKey = proto.String(config.APIKey)
		apiConfig.PlanModeApiProvider = &config.Provider
		apiConfig.PlanModeApiModelId = proto.String(config.ModelID)
		apiConfig.ActModeApiProvider = &config.Provider
		apiConfig.ActModeApiModelId = proto.String(config.ModelID)

	case cline.ApiProvider_BEDROCK:
		// For Bedrock, the API key is used as AWS access key
		// TODO: AWS config is simplified for now - need for creds to test with
		apiConfig.AwsAccessKey = proto.String(config.APIKey)
		apiConfig.PlanModeApiProvider = &config.Provider
		apiConfig.PlanModeAwsBedrockCustomModelBaseId = proto.String(config.ModelID)
		apiConfig.PlanModeApiModelId = proto.String(config.ModelID)
		apiConfig.ActModeApiProvider = &config.Provider
		apiConfig.ActModeAwsBedrockCustomModelBaseId = proto.String(config.ModelID)
		apiConfig.ActModeApiModelId = proto.String(config.ModelID)

	case cline.ApiProvider_GEMINI:
		apiConfig.GeminiApiKey = proto.String(config.APIKey)
		apiConfig.PlanModeApiProvider = &config.Provider
		apiConfig.PlanModeApiModelId = proto.String(config.ModelID)
		apiConfig.ActModeApiProvider = &config.Provider
		apiConfig.ActModeApiModelId = proto.String(config.ModelID)

	case cline.ApiProvider_OLLAMA:
		// Ollama will have baseUrl (optional) isntead of APIKey
		if config.APIKey != "" {
			apiConfig.OllamaBaseUrl = proto.String(config.APIKey)
		}
		apiConfig.PlanModeApiProvider = &config.Provider
		apiConfig.PlanModeOllamaModelId = proto.String(config.ModelID)
		apiConfig.PlanModeApiModelId = proto.String(config.ModelID)
		apiConfig.ActModeApiProvider = &config.Provider
		apiConfig.ActModeOllamaModelId = proto.String(config.ModelID)
		apiConfig.ActModeApiModelId = proto.String(config.ModelID)

	default:
		return nil, fmt.Errorf("unsupported provider: %v", config.Provider)
	}

	return &cline.UpdateSettingsRequest{
		ApiConfiguration: apiConfig,
	}, nil
}

// ApplyProviderConfiguration persists the provider configuration via UpdateSettings gRPC
func ApplyProviderConfiguration(ctx context.Context, manager *task.Manager, config ProviderConfig) error {
	// Build the update request
	request, err := BuildProviderUpdateRequest(config)
	if err != nil {
		return fmt.Errorf("failed to build update request: %w", err)
	}

	// Call UpdateSettings through the task manager
	if err := manager.UpdateSettings(ctx, request); err != nil {
		return fmt.Errorf("failed to update settings: %w", err)
	}

	return nil
}
