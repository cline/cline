package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

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
	apiConfig    map[string]interface{} // Store the raw apiConfig for scanning all providers
}

// GetProviderConfigurations retrieves and parses provider configurations from Cline Core state
func GetProviderConfigurations(ctx context.Context, manager *task.Manager) (*ProviderListResult, error) {
	if global.Config.Verbose {
		fmt.Println("[DEBUG] Retrieving provider configurations from Cline Core")
	}

	// Get latest state from Cline Core
	state, err := manager.GetClient().State.GetLatestState(ctx, &cline.EmptyRequest{})
	if err != nil {
		return nil, fmt.Errorf("failed to get state: %w", err)
	}

	stateJSON := state.StateJson

	if global.Config.Verbose {
		fmt.Printf("[DEBUG] Retrieved state, parsing JSON (length: %d)\n", len(stateJSON))
	}

	// Parse state_json as map[string]interface{}
	var stateData map[string]any
	if err := json.Unmarshal([]byte(stateJSON), &stateData); err != nil {
		return nil, fmt.Errorf("failed to parse state JSON: %w", err)
	}

	if global.Config.Verbose {
		fmt.Printf("[DEBUG] Parsed state data with %d keys\n", len(stateData))
	}

	// Extract apiConfiguration object from state
	apiConfig, ok := stateData["apiConfiguration"].(map[string]any)
	if !ok {
		if global.Config.Verbose {
			fmt.Println("[DEBUG] No apiConfiguration found in state")
		}
		return &ProviderListResult{
			apiConfig: make(map[string]interface{}),
		}, nil
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
		apiConfig:    apiConfig,
	}, nil
}

// GetAllReadyProviders returns all providers that have both a model and API key configured
func (r *ProviderListResult) GetAllReadyProviders() []*ProviderDisplay {
	if r.apiConfig == nil {
		return []*ProviderDisplay{}
	}

	var readyProviders []*ProviderDisplay
	seenProviders := make(map[cline.ApiProvider]bool)

	// Check all possible providers
	allProviders := []cline.ApiProvider{
		cline.ApiProvider_CLINE,
		cline.ApiProvider_ANTHROPIC,
		cline.ApiProvider_OPENAI,
		cline.ApiProvider_OPENAI_NATIVE,
		cline.ApiProvider_OPENROUTER,
		cline.ApiProvider_XAI,
		cline.ApiProvider_BEDROCK,
		cline.ApiProvider_GEMINI,
		cline.ApiProvider_OLLAMA,
		cline.ApiProvider_CEREBRAS,
		cline.ApiProvider_NOUSRESEARCH,
		cline.ApiProvider_OCA,
		cline.ApiProvider_HICAP,
	}

	// Check each provider to see if it's ready to use
	// We use "plan" mode to check, since both plan and act should have the same providers configured
	for _, provider := range allProviders {
		// Skip if we've already seen this provider
		if seenProviders[provider] {
			continue
		}

		// Check if this provider has a model configured
		modelID := getProviderSpecificModelID(r.apiConfig, "plan", provider)

		// Determine if credentials exist
		hasCreds := checkCredentialsExists(r.apiConfig, provider)

		// Determine readiness: OCA uses auth state presence; others need creds and model
		if provider == cline.ApiProvider_OCA {
			state, _ := GetLatestOCAState(context.Background(), 2*time.Second)
			if state == nil || state.User == nil {
				continue
			}
		} else {
			// Provider is not ready unless it has credentials AND a model configured
			if !hasCreds || modelID == "" {
				continue
			}
		}

		// Get base URL for Ollama
		baseURL := ""
		if provider == cline.ApiProvider_OLLAMA {
			if url, ok := r.apiConfig["ollamaBaseUrl"].(string); ok {
				baseURL = url
			}
		}

		// This provider is ready to use
		readyProviders = append(readyProviders, &ProviderDisplay{
			Mode:      "Ready",
			Provider:  provider,
			ModelID:   modelID,
			HasAPIKey: checkCredentialsExists(r.apiConfig, provider),
			BaseURL:   baseURL,
		})
		seenProviders[provider] = true
	}

	return readyProviders
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
	hasCredentials := checkCredentialsExists(stateData, provider)

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
		HasAPIKey: hasCredentials,
		BaseURL:   baseURL,
	}
}

// mapProviderStringToEnum converts provider string from state to ApiProvider enum
// Returns (provider, ok) where ok is false if the provider is unknown
func mapProviderStringToEnum(providerStr string) (cline.ApiProvider, bool) {
	normalizedStr := strings.ToLower(providerStr)

	// Map string values to enum values
	switch normalizedStr {
	case "anthropic":
		return cline.ApiProvider_ANTHROPIC, true
	case "openai", "openai-compatible": // internal name is 'openai', but this is actually the openai-compatible provider
		return cline.ApiProvider_OPENAI, true
	case "openai-native": // This is the native, official Open AI provider
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
	case "cerebras":
		return cline.ApiProvider_CEREBRAS, true
	case "cline":
		return cline.ApiProvider_CLINE, true
	case "oca":
		return cline.ApiProvider_OCA, true
	case "hicap":
		return cline.ApiProvider_HICAP, true
	case "nousResearch":
		return cline.ApiProvider_NOUSRESEARCH, true
	default:
		return cline.ApiProvider_ANTHROPIC, false // Return 0 value with false
	}
}

// GetProviderIDForEnum converts a provider enum to the provider ID string
// This is the inverse of mapProviderStringToEnum and is used for provider definitions
func GetProviderIDForEnum(provider cline.ApiProvider) string {
	switch provider {
	case cline.ApiProvider_ANTHROPIC:
		return "anthropic"
	case cline.ApiProvider_OPENAI:
		return "openai-compatible"
	case cline.ApiProvider_OPENAI_NATIVE:
		return "openai-native"
	case cline.ApiProvider_OPENROUTER:
		return "openrouter"
	case cline.ApiProvider_XAI:
		return "xai"
	case cline.ApiProvider_BEDROCK:
		return "bedrock"
	case cline.ApiProvider_GEMINI:
		return "gemini"
	case cline.ApiProvider_OLLAMA:
		return "ollama"
	case cline.ApiProvider_CEREBRAS:
		return "cerebras"
	case cline.ApiProvider_CLINE:
		return "cline"
	case cline.ApiProvider_OCA:
		return "oca"
	case cline.ApiProvider_HICAP:
		return "hicap"
	case cline.ApiProvider_NOUSRESEARCH:
		return "nousResearch"
	default:
		return ""
	}
}

// getProviderSpecificModelID gets the provider-specific model ID field from state
func getProviderSpecificModelID(stateData map[string]interface{}, mode string, provider cline.ApiProvider) string {
	modelKey, err := GetModelIDFieldName(provider, mode)
	if err != nil {
		if global.Config.Verbose {
			fmt.Printf("[DEBUG] Error getting model ID field name: %v\n", err)
		}
		return ""
	}

	if global.Config.Verbose {
		fmt.Printf("[DEBUG] Looking for model ID in key: %s\n", modelKey)
	}

	// Extract model ID from state
	modelID, _ := stateData[modelKey].(string)
	return modelID
}

// checkCredentialsExists checks if API key field exists in state (never retrieve actual key)
func checkCredentialsExists(stateData map[string]interface{}, provider cline.ApiProvider) bool {
	// Get field mapping from centralized function
	fields, err := GetProviderFields(provider)
	if err != nil {
		return false
	}

	// Check if the key exists and is not empty
	if value, ok := stateData[fields.APIKeyField]; ok {
		if str, ok := value.(string); ok && str != "" {
			return true
		}
	}

	if value, ok := stateData[fields.UseProfileField]; ok {
		if hasProfileField, ok := value.(bool); ok && hasProfileField {
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

// GetProviderDisplayName returns a user-friendly name for the provider
func GetProviderDisplayName(provider cline.ApiProvider) string {
	switch provider {
	case cline.ApiProvider_ANTHROPIC:
		return "Anthropic"
	case cline.ApiProvider_OPENAI:
		return "OpenAI Compatible"
	case cline.ApiProvider_OPENAI_NATIVE:
		return "OpenAI (Official)"
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
	case cline.ApiProvider_CEREBRAS:
		return "Cerebras"
	case cline.ApiProvider_CLINE:
		return "Cline (Official)"
	case cline.ApiProvider_OCA:
		return "Oracle Code Assist"
	case cline.ApiProvider_HICAP:
		return "Hicap"
	case cline.ApiProvider_NOUSRESEARCH:
		return "NousResearch"
	default:
		return "Unknown"
	}
}

// FormatProviderList formats the complete provider list for console display
// This now shows ALL providers that have both a model and API key configured
func FormatProviderList(result *ProviderListResult) string {
	var output strings.Builder

	output.WriteString("\n=== Configured API Providers ===\n\n")

	// Get the currently active provider
	var activeProvider cline.ApiProvider
	var activeProviderSet bool
	if result.ActProvider != nil {
		activeProvider = result.ActProvider.Provider
		activeProviderSet = true
	}

	// Get all ready-to-use providers (those with both API key and model configured)
	readyProviders := result.GetAllReadyProviders()

	if len(readyProviders) == 0 {
		output.WriteString("  No providers ready to use.\n")
		output.WriteString("  A provider is ready when it has both a model and API key configured.\n")
		output.WriteString("  Use 'Configure a new provider' to configure one.\n\n")
	} else {
		//output.WriteString(fmt.Sprintf("  %d provider(s) ready to use:\n\n", len(readyProviders)))

		for _, display := range readyProviders {
			// Check if this is the active provider
			isActive := activeProviderSet && display.Provider == activeProvider

			if isActive {
				output.WriteString(fmt.Sprintf("  ✓ %s (ACTIVE)\n", GetProviderDisplayName(display.Provider)))
			} else {
				output.WriteString(fmt.Sprintf("  • %s\n", GetProviderDisplayName(display.Provider)))
			}

			output.WriteString(fmt.Sprintf("    Model:    %s\n", display.ModelID))

			// Show status based on provider type
			if display.Provider == cline.ApiProvider_OLLAMA {
				if display.BaseURL != "" {
					output.WriteString(fmt.Sprintf("    Base URL: %s\n", display.BaseURL))
				} else {
					output.WriteString("    Base URL: (default)\n")
				}
			} else if display.Provider == cline.ApiProvider_CLINE || display.Provider == cline.ApiProvider_OCA {
				output.WriteString("    Status:   Authenticated\n")
			} else {
				output.WriteString("    API Key:  Configured\n")
			}

			output.WriteString("\n")
		}
	}

	output.WriteString("================================\n")

	return output.String()
}

// DetectAllConfiguredProviders scans the state to find all providers that have API keys configured.
// This allows switching between multiple providers even when only one is currently active.
func DetectAllConfiguredProviders(ctx context.Context, manager *task.Manager) ([]cline.ApiProvider, error) {
	verboseLog("[DEBUG] Detecting all configured providers...")

	// Get latest state from Cline Core
	state, err := manager.GetClient().State.GetLatestState(ctx, &cline.EmptyRequest{})
	if err != nil {
		return nil, fmt.Errorf("failed to get state: %w", err)
	}

	stateJSON := state.StateJson

	// Parse state_json as map[string]interface{}
	var stateData map[string]any
	if err := json.Unmarshal([]byte(stateJSON), &stateData); err != nil {
		return nil, fmt.Errorf("failed to parse state JSON: %w", err)
	}

	// Extract apiConfiguration object from state
	apiConfig, ok := stateData["apiConfiguration"].(map[string]any)
	if !ok {
		verboseLog("[DEBUG] No apiConfiguration found in state")
		verboseLog("[DEBUG] Available keys in stateData: %v", getMapKeys(stateData))
		return []cline.ApiProvider{}, nil
	}

	verboseLog("[DEBUG] apiConfiguration keys: %v", getMapKeys(apiConfig))

	var configuredProviders []cline.ApiProvider

	// Check for Cline provider (uses authentication instead of API key)
	if IsAuthenticated(ctx) {
		configuredProviders = append(configuredProviders, cline.ApiProvider_CLINE)
		verboseLog("[DEBUG] Cline provider is authenticated")
	}

	// Check OCA provider via global auth subscription (state presence)
	if state, _ := GetLatestOCAState(context.Background(), 2*time.Second); state != nil && state.User != nil {
		configuredProviders = append(configuredProviders, cline.ApiProvider_OCA)
		verboseLog("[DEBUG] OCA provider has active auth state")
	}

	// Check each BYO provider for API key presence
	providersToCheck := []struct {
		provider  cline.ApiProvider
		keyFields []string
	}{
		{cline.ApiProvider_ANTHROPIC, []string{"apiKey"}},
		{cline.ApiProvider_OPENAI, []string{"openAiApiKey"}},
		{cline.ApiProvider_OPENAI_NATIVE, []string{"openAiNativeApiKey"}},
		{cline.ApiProvider_OPENROUTER, []string{"openRouterApiKey"}},
		{cline.ApiProvider_XAI, []string{"xaiApiKey"}},
		{cline.ApiProvider_BEDROCK, []string{"awsAccessKey", "awsUseProfile"}},
		{cline.ApiProvider_GEMINI, []string{"geminiApiKey"}},
		{cline.ApiProvider_OLLAMA, []string{"ollamaBaseUrl"}}, // Ollama uses baseUrl instead of API key
		{cline.ApiProvider_CEREBRAS, []string{"cerebrasApiKey"}},
		{cline.ApiProvider_HICAP, []string{"hicapApiKey"}},
		{cline.ApiProvider_NOUSRESEARCH, []string{"nousResearchApiKey"}},
	}

	for _, providerCheck := range providersToCheck {
		verboseLog("[DEBUG] Checking for %s key: %s", GetProviderDisplayName(providerCheck.provider), providerCheck.keyFields)
		for _, keyField := range providerCheck.keyFields {
			if value, ok := apiConfig[keyField]; ok {
				verboseLog("[DEBUG]   Found key, value type: %T, is empty: %v", value, value == "")
				if str, ok := value.(string); ok && str != "" {
					configuredProviders = append(configuredProviders, providerCheck.provider)
					verboseLog("[DEBUG]   ✓ Provider %s is configured", GetProviderDisplayName(providerCheck.provider))
					break
				}
			} else {
				verboseLog("[DEBUG]   Key %s not found", keyField)
			}
		}
	}

	verboseLog("[DEBUG] Total configured providers: %d", len(configuredProviders))
	for _, p := range configuredProviders {
		verboseLog("[DEBUG]   - %s", GetProviderDisplayName(p))
	}

	return configuredProviders, nil
}

// getMapKeys returns the keys of a map for debugging
func getMapKeys(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
