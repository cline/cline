package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/cli/pkg/cli/task"
	"github.com/cline/grpc-go/cline"
)

// ProviderDisplay represents a configured provider for display purposes
type ProviderDisplay struct {
	Mode      string            // "Plan" or "Act"
	Provider  cline.ApiProvider // Provider enum
	ModelID   string            // Model identifier
	HasAPIKey bool              // Whether an API key is configured (never show actual key)
	BaseURL   string            // Base URL for providers like Ollama (can be shown publicly)
}

// ProviderListResult holds the parsed provider configuration from state
type ProviderListResult struct {
	PlanProvider *ProviderDisplay
	ActProvider  *ProviderDisplay
}

// GetProviderConfigurations retrieves and parses provider configurations from Cline Core state
func GetProviderConfigurations(ctx context.Context, manager *task.Manager) (*ProviderListResult, error) {
	if global.Config.Verbose {
		fmt.Println("[DEBUG] Retrieving provider configurations from Cline Core")
	}

	// Get latest state JSON from Cline Core
	stateJSON, err := manager.GetLatestStateJSON(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get state: %w", err)
	}

	if global.Config.Verbose {
		fmt.Printf("[DEBUG] Retrieved state, parsing JSON (length: %d)\n", len(stateJSON))
	}

	// Parse state_json as map[string]interface{}
	var stateData map[string]interface{}
	if err := json.Unmarshal([]byte(stateJSON), &stateData); err != nil {
		return nil, fmt.Errorf("failed to parse state JSON: %w", err)
	}

	if global.Config.Verbose {
		fmt.Printf("[DEBUG] Parsed state data with %d keys\n", len(stateData))
	}

	// Extract apiConfiguration object from state
	apiConfig, ok := stateData["apiConfiguration"].(map[string]interface{})
	if !ok {
		if global.Config.Verbose {
			fmt.Println("[DEBUG] No apiConfiguration found in state")
		}
		return &ProviderListResult{}, nil
	}

	if global.Config.Verbose {
		fmt.Printf("[DEBUG] Found apiConfiguration with %d keys\n", len(apiConfig))
	}

	// Extract plan mode configuration
	planProvider := extractProviderFromState(apiConfig, "plan")
	if global.Config.Verbose && planProvider != nil {
		fmt.Printf("[DEBUG] Plan mode: provider=%v, model=%s\n", planProvider.Provider, planProvider.ModelID)
	}

	// Extract act mode configuration
	actProvider := extractProviderFromState(apiConfig, "act")
	if global.Config.Verbose && actProvider != nil {
		fmt.Printf("[DEBUG] Act mode: provider=%v, model=%s\n", actProvider.Provider, actProvider.ModelID)
	}

	return &ProviderListResult{
		PlanProvider: planProvider,
		ActProvider:  actProvider,
	}, nil
}

// extractProviderFromState extracts provider configuration for specific plan/act mode
func extractProviderFromState(stateData map[string]interface{}, mode string) *ProviderDisplay {
	// Build key names based on mode
	providerKey := mode + "ModeApiProvider"

	// Extract provider string from state
	providerStr, ok := stateData[providerKey].(string)
	if !ok || providerStr == "" {
		if global.Config.Verbose {
			fmt.Printf("[DEBUG] No provider configured for %s mode\n", mode)
		}
		return nil
	}

	// Map provider string to enum
	provider, ok := mapProviderStringToEnum(providerStr)
	if !ok {
		if global.Config.Verbose {
			fmt.Printf("[DEBUG] Unknown provider type: %s\n", providerStr)
		}
		return nil
	}

	// Get provider-specific model ID
	modelID := getProviderSpecificModelID(stateData, mode, provider)

	// Check if API key exists
	hasAPIKey := checkAPIKeyExists(stateData, provider)

	// Get base URL for Ollama (can be shown publicly)
	baseURL := ""
	if provider == cline.ApiProvider_OLLAMA {
		if url, ok := stateData["ollamaBaseUrl"].(string); ok {
			baseURL = url
		}
	}

	return &ProviderDisplay{
		Mode:      capitalizeMode(mode),
		Provider:  provider,
		ModelID:   modelID,
		HasAPIKey: hasAPIKey,
		BaseURL:   baseURL,
	}
}

// mapProviderStringToEnum converts provider string from state to ApiProvider enum
// Returns (provider, ok) where ok is false if the provider is unknown
func mapProviderStringToEnum(providerStr string) (cline.ApiProvider, bool) {
	// Map string values to enum values
	switch providerStr {
	case "anthropic":
		return cline.ApiProvider_ANTHROPIC, true
	case "openai":
		return cline.ApiProvider_OPENAI, true
	case "openai-native":
		return cline.ApiProvider_OPENAI_NATIVE, true
	case "openrouter":
		return cline.ApiProvider_OPENROUTER, true
	case "xai":
		return cline.ApiProvider_XAI, true
	case "bedrock":
		return cline.ApiProvider_BEDROCK, true
	case "gemini":
		return cline.ApiProvider_GEMINI, true
	case "ollama":
		return cline.ApiProvider_OLLAMA, true
	default:
		return cline.ApiProvider_ANTHROPIC, false // Return 0 value with false
	}
}

// getProviderSpecificModelID gets the provider-specific model ID field from state
func getProviderSpecificModelID(stateData map[string]interface{}, mode string, provider cline.ApiProvider) string {
	var modelKey string

	// Different providers use different field names for model IDs
	switch provider {
	case cline.ApiProvider_OPENROUTER:
		modelKey = mode + "ModeOpenRouterModelId"
	case cline.ApiProvider_OPENAI:
		modelKey = mode + "ModeOpenAiModelId"
	case cline.ApiProvider_OPENAI_NATIVE:
		modelKey = mode + "ModeApiModelId"
	case cline.ApiProvider_BEDROCK:
		modelKey = mode + "ModeAwsBedrockCustomModelBaseId"
	case cline.ApiProvider_OLLAMA:
		modelKey = mode + "ModeOllamaModelId"
	case cline.ApiProvider_ANTHROPIC, cline.ApiProvider_XAI, cline.ApiProvider_GEMINI:
		// These providers use the generic apiModelId field
		modelKey = mode + "ModeApiModelId"
	default:
		modelKey = mode + "ModeApiModelId"
	}

	if global.Config.Verbose {
		fmt.Printf("[DEBUG] Looking for model ID in key: %s\n", modelKey)
	}

	// Extract model ID from state
	modelID, _ := stateData[modelKey].(string)
	return modelID
}

// checkAPIKeyExists checks if API key field exists in state (never retrieve actual key)
func checkAPIKeyExists(stateData map[string]interface{}, provider cline.ApiProvider) bool {
	var keyField string

	// Map provider to its specific API key field name
	switch provider {
	case cline.ApiProvider_ANTHROPIC:
		keyField = "apiKey"
	case cline.ApiProvider_OPENAI:
		keyField = "openAiApiKey"
	case cline.ApiProvider_OPENAI_NATIVE:
		keyField = "openAiNativeApiKey"
	case cline.ApiProvider_OPENROUTER:
		keyField = "openRouterApiKey"
	case cline.ApiProvider_XAI:
		keyField = "xaiApiKey"
	case cline.ApiProvider_BEDROCK:
		keyField = "awsAccessKey"
	case cline.ApiProvider_GEMINI:
		keyField = "geminiApiKey"
	case cline.ApiProvider_OLLAMA:
		// Ollama might use base URL instead of API key
		keyField = "ollamaBaseUrl"
	default:
		return false
	}

	// Check if the key exists and is not empty
	if value, ok := stateData[keyField]; ok {
		if str, ok := value.(string); ok && str != "" {
			return true
		}
	}

	return false
}

// capitalizeMode capitalizes the mode string for display
func capitalizeMode(mode string) string {
	if len(mode) == 0 {
		return mode
	}
	return strings.ToUpper(mode[:1]) + mode[1:]
}

// getProviderDisplayName returns a user-friendly name for the provider
func getProviderDisplayName(provider cline.ApiProvider) string {
	switch provider {
	case cline.ApiProvider_ANTHROPIC:
		return "Anthropic"
	case cline.ApiProvider_OPENAI:
		return "OpenAI"
	case cline.ApiProvider_OPENAI_NATIVE:
		return "OpenAI Native"
	case cline.ApiProvider_OPENROUTER:
		return "OpenRouter"
	case cline.ApiProvider_XAI:
		return "X AI (Grok)"
	case cline.ApiProvider_BEDROCK:
		return "AWS Bedrock"
	case cline.ApiProvider_GEMINI:
		return "Google Gemini"
	case cline.ApiProvider_OLLAMA:
		return "Ollama"
	default:
		return "Unknown"
	}
}

// formatProviderDisplay formats a single provider configuration for display
func formatProviderDisplay(display *ProviderDisplay) string {
	var output strings.Builder

	output.WriteString(fmt.Sprintf("  %s Mode:\n", display.Mode))
	output.WriteString(fmt.Sprintf("    Provider: %s\n", getProviderDisplayName(display.Provider)))
	
	if display.ModelID != "" {
		output.WriteString(fmt.Sprintf("    Model ID: %s\n", display.ModelID))
	} else {
		output.WriteString("    Model ID: (not configured)\n")
	}

	// For Ollama, show the actual base URL (not sensitive)
	// For other providers, just show if API key is configured (don't show actual key)
	if display.Provider == cline.ApiProvider_OLLAMA {
		if display.BaseURL != "" {
			output.WriteString(fmt.Sprintf("    Base URL: %s\n", display.BaseURL))
		} else {
			output.WriteString("    Base URL: (not configured)\n")
		}
	} else {
		if display.HasAPIKey {
			output.WriteString("    API Key:  ✓ Configured\n")
		} else {
			output.WriteString("    API Key:  ✗ Not configured\n")
		}
	}

	output.WriteString("\n")

	return output.String()
}

// FormatProviderList formats the complete provider list for console display
func FormatProviderList(result *ProviderListResult) string {
	var output strings.Builder

	output.WriteString("\n=== Configured API Providers ===\n\n")

	hasAnyProvider := false

	if result.PlanProvider != nil {
		output.WriteString(formatProviderDisplay(result.PlanProvider))
		hasAnyProvider = true
	}

	if result.ActProvider != nil {
		output.WriteString(formatProviderDisplay(result.ActProvider))
		hasAnyProvider = true
	}

	if !hasAnyProvider {
		output.WriteString("  No providers configured.\n")
		output.WriteString("  Use 'Add a new provider' to configure one.\n\n")
	}

	output.WriteString("================================\n")

	return output.String()
}
