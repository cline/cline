package auth

import (
	"context"
	"fmt"
	"strings"

	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/cli/pkg/cli/task"
	"github.com/cline/grpc-go/cline"
)

// Package-level variables for command-line flags
var (
	QuickProvider string // Provider ID (e.g., "openai", "anthropic")
	QuickAPIKey   string // API key for the provider
	QuickModelID  string // Model ID to configure
	QuickBaseURL  string // Base URL (optional, for openai compatible only)
)

// QuickSetupFromFlags performs quick setup using command-line flags
// Returns error if validation fails or configuration cannot be applied
func QuickSetupFromFlags(ctx context.Context, provider, apiKey, modelID, baseURL string) error {
	// Validate all input parameters
	providerEnum, err := validateQuickSetupInputs(provider, apiKey, modelID, baseURL)
	if err != nil {
		return err
	}

	// Create task manager for state operations
	manager, err := createTaskManager(ctx)
	if err != nil {
		return fmt.Errorf("failed to create task manager: %w", err)
	}

	// Validate and fetch model information if needed
	finalModelID, modelInfo, err := validateAndFetchModel(ctx, manager, providerEnum, modelID, apiKey)
	if err != nil {
		return fmt.Errorf("model validation failed: %w", err)
	}

	// For Ollama, baseURL is stored in the API key field
	finalAPIKey := apiKey
	finalBaseURL := baseURL
	if providerEnum == cline.ApiProvider_OLLAMA {
		if baseURL != "" {
			finalAPIKey = baseURL
			finalBaseURL = ""
		} else if apiKey != "" {
			// User provided API key for Ollama - treat it as baseURL
			finalAPIKey = apiKey
			finalBaseURL = ""
		} else {
			// Use default Ollama baseURL
			finalAPIKey = "http://localhost:11434"
			finalBaseURL = ""
		}
	}

	// Configure the provider using existing AddProviderPartial function
	if err := AddProviderPartial(ctx, manager, providerEnum, finalModelID, finalAPIKey, finalBaseURL, modelInfo); err != nil {
		return fmt.Errorf("failed to configure provider: %w", err)
	}

	// Set the provider as active for both Plan and Act modes
	if err := UpdateProviderPartial(ctx, manager, providerEnum, ProviderUpdatesPartial{}, true); err != nil {
		return fmt.Errorf("failed to set provider as active: %w", err)
	}

	// Mark welcome view as completed
	if err := markWelcomeViewCompleted(ctx, manager); err != nil {
		// Non-fatal error, just log it
		if global.Config.Verbose {
			fmt.Printf("[DEBUG] Warning: failed to mark welcome view as completed: %v\n", err)
		}
	}

	// Flush pending state changes to disk immediately
	// This ensures all configuration changes are persisted before the instance terminates
	if _, err := manager.GetClient().State.FlushPendingState(ctx, &cline.EmptyRequest{}); err != nil {
		return fmt.Errorf("failed to flush pending state: %w", err)
	}

	// Success message
	fmt.Printf("\n✓ Successfully configured %s provider\n", GetProviderDisplayName(providerEnum))
	fmt.Printf("  Model: %s\n", finalModelID)
	if providerEnum == cline.ApiProvider_OLLAMA {
		fmt.Printf("  Base URL: %s\n", finalAPIKey)
	} else {
		fmt.Println("  API Key: Configured")
	}
	if finalBaseURL != "" {
		fmt.Printf("  Custom Base URL: %s\n", finalBaseURL)
	}
	fmt.Println("\nYou can now use Cline with this provider.")
	fmt.Println("Run 'cline start' to begin a new task.")

	return nil
}

// validateQuickSetupInputs validates all input parameters for quick setup
// Returns the validated provider enum or an error if validation fails
func validateQuickSetupInputs(provider, apiKey, modelID, baseURL string) (cline.ApiProvider, error) {
	// Validate required parameters
	if provider == "" {
		return cline.ApiProvider_ANTHROPIC, fmt.Errorf("provider is required. Use --provider or -p flag")
	}

	if strings.TrimSpace(apiKey) == "" && provider != "ollama" {
		return cline.ApiProvider_ANTHROPIC, fmt.Errorf("API key is required for %s provider. Use --apikey or -k flag", provider)
	}

	if strings.TrimSpace(modelID) == "" {
		return cline.ApiProvider_ANTHROPIC, fmt.Errorf("model ID is required. Use --modelid or -m flag")
	}

	// Validate and map provider string to enum
	providerEnum, err := validateQuickSetupProvider(provider)
	if err != nil {
		return cline.ApiProvider_ANTHROPIC, err
	}

	// Validate that baseURL is only provided for OpenAI-compatible providers
	if err := validateBaseURL(baseURL, providerEnum); err != nil {
		return cline.ApiProvider_ANTHROPIC, err
	}

	return providerEnum, nil
}

// validateBaseURL checks if the user's input includes a baseURL for a provider other than OpenAI (compatible)
// Returns error if baseURL is provided for unsupported providers
func validateBaseURL(baseURL string, providerEnum cline.ApiProvider) error {
	if providerEnum != cline.ApiProvider_OPENAI {
		if baseURL != "" {
			return fmt.Errorf("base URL is only supported for OpenAI and OpenAI-compatible providers")
		}
	}
	return nil
}


// validateQuickSetupProvider validates the provider ID and returns the enum value
// Returns error if provider is invalid or not supported for quick setup
func validateQuickSetupProvider(providerID string) (cline.ApiProvider, error) {
	// Normalize provider ID (trim whitespace, lowercase)
	normalizedID := strings.TrimSpace(strings.ToLower(providerID))

	// Explicitly block Bedrock
	if normalizedID == "bedrock" {
		return cline.ApiProvider_BEDROCK, fmt.Errorf("bedrock provider is not supported for quick setup due to complex authentication requirements. Please use interactive setup: cline auth")
	}

	// Map provider string to enum using existing function
	provider, ok := mapProviderStringToEnum(normalizedID)
	if !ok {
		// Provider not found - provide helpful error message
		supportedProviders := []string{
			"openai-native", "openai", "anthropic", "gemini",
			"openrouter", "xai", "cerebras", "ollama",
		}
		return cline.ApiProvider_ANTHROPIC, fmt.Errorf(
			"invalid provider '%s'. Supported providers: %s",
			providerID,
			strings.Join(supportedProviders, ", "),
		)
	}

	// Validate against supported quick setup providers
	supportedProviders := map[cline.ApiProvider]bool{
		cline.ApiProvider_OPENAI_NATIVE: true,
		cline.ApiProvider_OPENAI:        true,
		cline.ApiProvider_ANTHROPIC:     true,
		cline.ApiProvider_GEMINI:        true,
		cline.ApiProvider_OPENROUTER:    true,
		cline.ApiProvider_XAI:           true,
		cline.ApiProvider_CEREBRAS:      true,
		cline.ApiProvider_OLLAMA:        true,
		cline.ApiProvider_NOUSRESEARCH:  true,
	}

	if !supportedProviders[provider] {
		return provider, fmt.Errorf(
			"provider '%s' is not supported for quick setup. Please use interactive setup: cline auth",
			providerID,
		)
	}

	return provider, nil
}

// validateAndFetchModel validates the model ID or fetches from provider if needed
// Returns the final model ID and optional model info
// For providers with static models, validates against the list
// For providers with dynamic models, fetches the list if possible
func validateAndFetchModel(ctx context.Context, manager *task.Manager, provider cline.ApiProvider, modelID, apiKey string) (string, interface{}, error) {
	// Normalize model ID
	modelID = strings.TrimSpace(modelID)
	if modelID == "" {
		return "", nil, fmt.Errorf("model ID cannot be empty")
	}

	// For most providers, we trust the user's input since we can't easily validate without making API calls
	// The actual validation will happen when the model is used
	switch provider {
	case cline.ApiProvider_OPENROUTER:
		// OpenRouter supports model info fetching, but it requires an API call
		// For quick setup, we'll trust the user's input and return nil for model info
		// The actual model info will be fetched when needed
		if global.Config.Verbose {
			fmt.Printf("[DEBUG] OpenRouter model ID: %s (will be validated on first use)\n", modelID)
		}
		return modelID, nil, nil

	case cline.ApiProvider_OLLAMA:
		// Ollama models can be validated by fetching the list, but this requires the server to be running
		// For quick setup, we'll trust the user's input
		if global.Config.Verbose {
			fmt.Printf("[DEBUG] Ollama model ID: %s (will be validated when server is accessible)\n", modelID)
		}
		return modelID, nil, nil

	default:
		// For other providers (Anthropic, OpenAI, Gemini, XAI, Cerebras), trust user input
		// Model validation will occur when the model is actually used
		if global.Config.Verbose {
			fmt.Printf("[DEBUG] %s model ID: %s (will be validated on first use)\n", GetProviderDisplayName(provider), modelID)
		}
		return modelID, nil, nil
	}
}

// markWelcomeViewCompleted marks the welcome view as completed in the state
// This prevents the welcome view from showing up after quick setup
func markWelcomeViewCompleted(ctx context.Context, manager *task.Manager) error {
	// Use the State service to update the welcome view flag
	_, err := manager.GetClient().State.SetWelcomeViewCompleted(ctx, &cline.BooleanRequest{Value: true})
	if err != nil {
		return fmt.Errorf("failed to mark welcome view as completed: %w", err)
	}

	if global.Config.Verbose {
		fmt.Println("[DEBUG] Marked welcome view as completed")
	}

	return nil
}
