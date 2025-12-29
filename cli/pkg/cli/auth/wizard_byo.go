package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/huh"
	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/cli/pkg/cli/task"
	"github.com/cline/grpc-go/cline"
)

// ProviderWizard handles the interactive provider configuration process
type ProviderWizard struct {
	ctx     context.Context
	manager *task.Manager
}

// NewProviderWizard prepares a new provider configuration wizard
func NewProviderWizard(ctx context.Context) (*ProviderWizard, error) {
	// Create task manager using auth instance from context
	manager, err := createTaskManager(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create task manager: %w", err)
	}

	return &ProviderWizard{
		ctx:     ctx,
		manager: manager,
	}, nil
}

// showMainMenu displays the main provider configuration menu
func (pw *ProviderWizard) showMainMenu() (string, error) {
	var action string
	form := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("What would you like to do?").
				Options(
					huh.NewOption("Add or change an API provider", "add"),
					huh.NewOption("Change model for API provider", "change-model"),
					huh.NewOption("Remove a provider", "remove"),
					huh.NewOption("List configured providers", "list"),
					huh.NewOption("Return to main auth menu", "back"),
				).
				Value(&action),
		),
	)

	if err := form.Run(); err != nil {
		return "", fmt.Errorf("failed to get menu choice: %w", err)
	}

	return action, nil
}

// Run runs the provider configuration wizard
func (pw *ProviderWizard) Run() error {

	for {
		action, err := pw.showMainMenu()
		if err != nil {
			return err
		}

		switch action {
		case "add":
			if err := pw.handleAddProvider(); err != nil {
				return err
			}
		case "change-model":
			if err := pw.handleChangeModel(); err != nil {
				return err
			}
		case "remove":
			if err := pw.handleRemoveProvider(); err != nil {
				return err
			}
		case "list":
			if err := pw.handleListProviders(); err != nil {
				return err
			}
		case "back":
			// Return to main auth menu
			return HandleAuthMenuNoArgs(pw.ctx)
		}
		fmt.Println()
	}
}

// "Add a new provider" > handleAddProvider
func (pw *ProviderWizard) handleAddProvider() error {
	// Step 1: Select provider
	provider, err := SelectBYOProvider()
	if err != nil {
		if strings.Contains(err.Error(), "cancelled") {
			return nil
		}
		return fmt.Errorf("provider selection failed: %w", err)
	}

	// Step 2: Special handling for Bedrock provider
	if provider == cline.ApiProvider_BEDROCK {
		return pw.handleAddBedrockProvider()
	}

	// Step 2b: Special handling for OCA provider
	if provider == cline.ApiProvider_OCA {
		return pw.handleAddOcaProvider()
	}

	// Step 3: Get API key first (for non-Bedrock providers)
	apiKey, baseURL, err := PromptForAPIKey(provider)
	if err != nil {
		return fmt.Errorf("failed to get API key: %w", err)
	}

	// Step 4: Try to fetch models and let user select (with fallback to manual entry for providers that don't support fetch)
	modelID, modelInfo, err := pw.selectModel(provider, apiKey)
	if err != nil {
		return fmt.Errorf("model selection failed: %w", err)
	}

	// Step 5: Apply configuration using AddProviderPartial
	if err := AddProviderPartial(pw.ctx, pw.manager, provider, modelID, apiKey, baseURL, modelInfo); err != nil {
		return fmt.Errorf("failed to save configuration: %w", err)
	}

	if err := setWelcomeViewCompleted(pw.ctx, pw.manager); err != nil {
		verboseLog("Warning: Failed to mark welcome view as completed: %v", err)
	}

	fmt.Println("✓ Provider configured successfully!")
	return nil
}

// handleAddBedrockProvider handles the special case of adding Bedrock provider with its multi-field form
func (pw *ProviderWizard) handleAddBedrockProvider() error {
	// Step 1: Get Bedrock configuration (all credentials and optional fields)
	config, err := PromptForBedrockConfig(pw.ctx, pw.manager)
	if err != nil {
		if strings.Contains(err.Error(), "user declined profile authentication") {
			return nil
		}
		return fmt.Errorf("failed to get Bedrock configuration: %w", err)
	}

	// Step 2: Select model
	modelID, modelInfo, err := pw.selectModel(cline.ApiProvider_BEDROCK, "")
	if err != nil {
		return fmt.Errorf("model selection failed: %w", err)
	}

	// Step 3: Apply Bedrock configuration
	if err := ApplyBedrockConfig(pw.ctx, pw.manager, config, modelID, modelInfo); err != nil {
		return fmt.Errorf("failed to save Bedrock configuration: %w", err)
	}

	if err := setWelcomeViewCompleted(pw.ctx, pw.manager); err != nil {
		verboseLog("Warning: Failed to mark welcome view as completed: %v", err)
	}

	fmt.Println("✓ Bedrock provider configured successfully!")
	return nil
}

// handleAddOcaProvider handles adding Oracle Code Assist provider with optional settings and auth
func (pw *ProviderWizard) handleAddOcaProvider() error {
	// Step 1: Get OCA configuration (base URL and mode)
	config, err := PromptForOcaConfig(pw.ctx, pw.manager)
	if err != nil {
		if strings.Contains(err.Error(), "user aborted") || strings.Contains(err.Error(), "cancelled") {
			return nil
		}
		return fmt.Errorf("failed to get OCA configuration: %w", err)
	}

	// Apply OCA configuration (base URL and mode)
	if err := ApplyOcaConfig(pw.ctx, pw.manager, config); err != nil {
		return fmt.Errorf("failed to save OCA configuration: %w", err)
	}

	// Step 2: Ensure OCA authentication
	if err := ensureOcaAuthenticated(pw.ctx); err != nil {
		return fmt.Errorf("failed to authenticate with OCA: %w", err)
	}

	// Step 3: Select model
	modelID, _, err := pw.selectModel(cline.ApiProvider_OCA, "")
	if err != nil {
		return fmt.Errorf("model selection failed: %w", err)
	}

	// Step 4: Apply the OCA model configuration and set as active
	updates := ProviderUpdatesPartial{
		ModelID:   &modelID,
		ModelInfo: nil,
	}

	if err := UpdateProviderPartial(pw.ctx, pw.manager, cline.ApiProvider_OCA, updates, true); err != nil {
		return fmt.Errorf("failed to save OCA configuration: %w", err)
	}

	if err := setWelcomeViewCompleted(pw.ctx, pw.manager); err != nil {
		verboseLog("Warning: Failed to mark welcome view as completed: %v", err)
	}

	fmt.Println("✓ OCA provider configured successfully!")
	return nil
}

// handleListProviders retrieves and displays configured providers
func (pw *ProviderWizard) handleListProviders() error {
	result, err := GetProviderConfigurations(pw.ctx, pw.manager)
	if err != nil {
		return fmt.Errorf("failed to retrieve provider configurations: %w", err)
	}

	output := FormatProviderList(result)
	fmt.Println(output)

	return nil
}

// selectModel attempts to fetch available models and let user select, or falls back to manual entry
func (pw *ProviderWizard) selectModel(provider cline.ApiProvider, apiKey string) (string, interface{}, error) {
	// For providers that support model fetching, try to fetch and display models
	canFetchModels := pw.supportsModelFetching(provider)

	if canFetchModels {
		fmt.Println("Fetching available models...")
		models, modelInfoMap, err := pw.fetchModelsForProvider(provider, apiKey)

		if err != nil {
			fmt.Println("\n⚠ Unable to fetch model list from the provider. Please enter the model ID manually instead.")
			if global.Config.Verbose {
				fmt.Printf("   Error details: %v\n", err)
			}
			return pw.manualModelEntry(provider)
		}

		if len(models) == 0 {
			fmt.Println("\n⚠ No models found from the provider. Please enter the model ID manually instead.")
			return pw.manualModelEntry(provider)
		}

		// Let user select from available models (includes manual entry option)
		modelID, err := pw.selectFromAvailableModels(models)
		if err != nil {
			return "", nil, fmt.Errorf("model selection failed: %w", err)
		}

		// Check if user chose manual entry
		const manualEntryKey = "__MANUAL_ENTRY__"
		if modelID == manualEntryKey {
			return pw.manualModelEntry(provider)
		}

		// Get the model info for the selected model
		var modelInfo interface{}
		if modelInfoMap != nil {
			modelInfo = modelInfoMap[modelID]
		}

		return modelID, modelInfo, nil
	}

	// For providers without model fetching support, use manual entry
	return pw.manualModelEntry(provider)
}

// supportsModelFetching returns true if the provider supports fetching models
func (pw *ProviderWizard) supportsModelFetching(provider cline.ApiProvider) bool {
	return SupportsBYOModelFetching(provider)
}

// fetchModelsForProvider fetches models for a given provider
// Supports both dynamic API fetching (OpenRouter, OpenAI, Ollama) and static model lists (Anthropic, Bedrock, Gemini, X AI)
func (pw *ProviderWizard) fetchModelsForProvider(provider cline.ApiProvider, apiKey string) ([]string, map[string]interface{}, error) {
	// Try dynamic/remote model fetching first
	switch provider {
	case cline.ApiProvider_OPENROUTER:
		models, err := FetchOpenRouterModels(pw.ctx, pw.manager)
		if err != nil {
			return nil, nil, err
		}
		interfaceMap := ConvertOpenRouterModelsToInterface(models)
		return ConvertModelsMapToSlice(interfaceMap), interfaceMap, nil

	case cline.ApiProvider_OPENAI:
		// For OpenAI, we need to pass the base URL and API key
		baseURL := "https://api.openai.com/v1" // Default OpenAI API base URL
		modelIDs, err := FetchOpenAiModels(pw.ctx, pw.manager, baseURL, apiKey)
		if err != nil {
			return nil, nil, err
		}
		// OpenAI returns just model IDs without additional info, so modelInfo map is nil
		return modelIDs, nil, nil

	case cline.ApiProvider_OLLAMA:
		// For Ollama, apiKey actually contains the base URL (or empty for default)
		baseURL := apiKey // The "API key" field for Ollama is actually the base URL
		modelIDs, err := FetchOllamaModels(pw.ctx, pw.manager, baseURL)
		if err != nil {
			return nil, nil, err
		}
		// Ollama returns just model IDs without additional info, so modelInfo map is nil
		return modelIDs, nil, nil

	case cline.ApiProvider_OCA:
		// OCA supports dynamic model fetching
		models, err := FetchOcaModels(pw.ctx, pw.manager)
		if err != nil {
			return nil, nil, err
		}
		interfaceMap := ConvertOcaModelsToInterface(models)
		return ConvertModelsMapToSlice(interfaceMap), interfaceMap, nil
	}

	// Fall back to static models for providers that don't support dynamic fetching
	if SupportsStaticModelList(provider) {
		modelIDs, _, err := FetchStaticModels(provider)
		if err != nil {
			return nil, nil, err
		}
		// Static models don't have detailed info maps for now, so modelInfo map is nil
		return modelIDs, nil, nil
	}

	return nil, nil, fmt.Errorf("model fetching not supported for provider: %v", provider)
}

// selectFromAvailableModels displays available models and lets user select one.
// Includes an option to enter a model ID manually in case the desired model isn't listed.
func (pw *ProviderWizard) selectFromAvailableModels(models []string) (string, error) {
	if len(models) == 0 {
		return "", fmt.Errorf("no models available")
	}

	// Add a special "manual entry" option at the end
	const manualEntryKey = "__MANUAL_ENTRY__"

	// Use model ID as the value (not index)
	var selectedModel string
	options := make([]huh.Option[string], len(models)+1)
	for i, model := range models {
		options[i] = huh.NewOption(model, model)
	}
	// Add manual entry option at the end
	options[len(models)] = huh.NewOption("Enter model ID manually...", manualEntryKey)

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Select a model").
				Options(options...).
				Height(calculateSelectHeight()).
				Filtering(true).
				Value(&selectedModel),
		),
	)

	if err := form.Run(); err != nil {
		return "", fmt.Errorf("failed to select model: %w", err)
	}

	// If user selected manual entry, return special key to trigger manual input
	if selectedModel == manualEntryKey {
		return manualEntryKey, nil
	}

	return selectedModel, nil
}

// manualModelEntry prompts user to manually enter a model ID.
// Returns the model ID and an error. The modelInfo is always nil for manual entry.
func (pw *ProviderWizard) manualModelEntry(provider cline.ApiProvider) (string, interface{}, error) {
	var modelID string
	modelPlaceholder := GetBYOProviderPlaceholder(provider)

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title("Model ID").
				Placeholder(modelPlaceholder).
				Value(&modelID).
				Validate(func(s string) error {
					// Trim whitespace and validate
					trimmed := strings.TrimSpace(s)
					if trimmed == "" {
						return fmt.Errorf("model ID cannot be empty")
					}
					return nil
				}),
		),
	)

	if err := form.Run(); err != nil {
		return "", nil, fmt.Errorf("failed to get model ID: %w", err)
	}

	// Trim whitespace from the final value
	modelID = strings.TrimSpace(modelID)

	// modelInfo is always nil for manual entry
	return modelID, nil, nil
}

// handleChangeModel allows changing the model for any configured provider
func (pw *ProviderWizard) handleChangeModel() error {
	// Step 1: Get current provider configurations
	result, err := GetProviderConfigurations(pw.ctx, pw.manager)
	if err != nil {
		return fmt.Errorf("failed to retrieve provider configurations: %w", err)
	}

	// Step 2: Get all configured providers with models
	readyProviders := result.GetAllReadyProviders()

	// Filter out Cline provider (it has its own model changer in the main menu)
	var configurableProviders []*ProviderDisplay
	for _, provider := range readyProviders {
		if provider.Provider != cline.ApiProvider_CLINE {
			configurableProviders = append(configurableProviders, provider)
		}
	}

	// Step 3: Check if there are any configurable providers
	if len(configurableProviders) == 0 {
		fmt.Println("\nNo configurable providers found.")
		fmt.Println("Note: Cline provider has its own model selection in the main menu.")
		return nil
	}

	// Step 4: Let user select which provider to change the model for
	var selectedIndex int
	options := make([]huh.Option[int], len(configurableProviders)+1)
	for i, providerDisplay := range configurableProviders {
		displayName := fmt.Sprintf("%s (current: %s)",
			GetProviderDisplayName(providerDisplay.Provider),
			providerDisplay.ModelID)
		options[i] = huh.NewOption(displayName, i)
	}
	options[len(configurableProviders)] = huh.NewOption("(Cancel)", -1)

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[int]().
				Title("Select provider to change model for").
				Options(options...).
				Value(&selectedIndex),
		),
	)

	if err := form.Run(); err != nil {
		return fmt.Errorf("failed to select provider: %w", err)
	}

	if selectedIndex == -1 {
		return nil
	}

	selectedProvider := configurableProviders[selectedIndex]
	provider := selectedProvider.Provider

	fmt.Printf("\nChanging model for %s\n", GetProviderDisplayName(provider))
	fmt.Printf("Current model: %s\n\n", selectedProvider.ModelID)

	// Step 5: Retrieve API key if needed for model fetching
	var apiKey string
	if pw.supportsModelFetching(provider) {
		// For providers that support fetching, we need to retrieve the API key from state
		state, err := pw.manager.GetClient().State.GetLatestState(pw.ctx, &cline.EmptyRequest{})
		if err != nil {
			return fmt.Errorf("failed to get state: %w", err)
		}

		var stateData map[string]interface{}
		if err := json.Unmarshal([]byte(state.StateJson), &stateData); err != nil {
			return fmt.Errorf("failed to parse state JSON: %w", err)
		}

		apiConfig, ok := stateData["apiConfiguration"].(map[string]interface{})
		if !ok {
			return fmt.Errorf("no API configuration found in state")
		}

		apiKey = getProviderAPIKeyFromState(apiConfig, provider)
		if apiKey == "" {
			return fmt.Errorf("no API key found for provider %s", GetProviderDisplayName(provider))
		}
	}

	modelID, modelInfo, err := pw.selectModel(provider, apiKey)
	if err != nil {
		return fmt.Errorf("model selection failed: %w", err)
	}

	// Step 6: Apply the model change (for both Plan and Act modes)
	if err := pw.applyModelChange(provider, modelID, modelInfo); err != nil {
		return fmt.Errorf("failed to apply model change: %w", err)
	}

	fmt.Printf("✓ Model changed successfully to: %s\n", modelID)
	fmt.Println("  (Applied to both Plan and Act modes)")
	return nil
}

// applyModelChange applies a model change for both Plan and Act modes using UpdateProviderPartial
func (pw *ProviderWizard) applyModelChange(provider cline.ApiProvider, modelID string, modelInfo interface{}) error {
	updates := ProviderUpdatesPartial{
		ModelID:   &modelID,
		ModelInfo: modelInfo,
	}

	return UpdateProviderPartial(pw.ctx, pw.manager, provider, updates, true)
}

// SwitchToBYOProvider switches to a BYO provider that's already configured.
// It retrieves the existing model configuration and sets it as the active provider for both Plan and Act modes.
func SwitchToBYOProvider(ctx context.Context, manager *task.Manager, provider cline.ApiProvider) error {
	// Get the current state to retrieve the model ID and model info for this provider
	state, err := manager.GetClient().State.GetLatestState(ctx, &cline.EmptyRequest{})
	if err != nil {
		return fmt.Errorf("failed to get state: %w", err)
	}

	// Parse state JSON
	var stateData map[string]interface{}
	if err := json.Unmarshal([]byte(state.StateJson), &stateData); err != nil {
		return fmt.Errorf("failed to parse state JSON: %w", err)
	}

	// Extract apiConfiguration
	apiConfig, ok := stateData["apiConfiguration"].(map[string]interface{})
	if !ok {
		return fmt.Errorf("no API configuration found in state")
	}

	// Get the model ID for the selected provider
	modelID := getProviderModelIDFromState(apiConfig, provider)
	if modelID == "" {
		return fmt.Errorf("no model configured for provider %s", GetProviderDisplayName(provider))
	}

	// Get model info if available (for OpenRouter/Cline)
	var modelInfo interface{}
	if provider == cline.ApiProvider_OPENROUTER || provider == cline.ApiProvider_CLINE {
		if modelInfoData, ok := apiConfig["planModeOpenRouterModelInfo"].(map[string]interface{}); ok {
			modelInfo = convertMapToOpenRouterModelInfo(modelInfoData)
		}
	}

	// Use UpdateProviderPartial to switch to this provider
	updates := ProviderUpdatesPartial{
		ModelID:   &modelID,
		ModelInfo: modelInfo,
	}

	if err := UpdateProviderPartial(ctx, manager, provider, updates, true); err != nil {
		return fmt.Errorf("failed to switch provider: %w", err)
	}

	verboseLog("✓ Switched to %s\n", GetProviderDisplayName(provider))
	verboseLog("  Using model: %s\n", modelID)

	return HandleAuthMenuNoArgs(ctx)
}

// getProviderModelIDFromState retrieves the model ID for a specific provider from state
func getProviderModelIDFromState(stateData map[string]interface{}, provider cline.ApiProvider) string {
	modelKey, err := GetModelIDFieldName(provider, "plan")
	if err != nil {
		return ""
	}

	if modelID, ok := stateData[modelKey].(string); ok {
		return modelID
	}

	return ""
}

 // getProviderAPIKeyFromState retrieves the API key for a specific provider from state
func getProviderAPIKeyFromState(stateData map[string]interface{}, provider cline.ApiProvider) string {
	// OCA uses account authentication, not API keys. Consider it "present" if authenticated.
	if provider == cline.ApiProvider_OCA {
		if state, _ := GetLatestOCAState(context.TODO(), 2 * time.Second); state != nil && state.User != nil {
			// Return a sentinel non-empty string so upstream checks pass.
			return "OCA_AUTH_VERIFIED"
		}
		return ""
	}

	fields, err := GetProviderFields(provider)
	if err != nil {
		return ""
	}

	if apiKey, ok := stateData[fields.APIKeyField].(string); ok {
		return apiKey
	}

	return ""
}

// convertMapToOpenRouterModelInfo converts a map to OpenRouterModelInfo
func convertMapToOpenRouterModelInfo(data map[string]interface{}) *cline.OpenRouterModelInfo {
	info := &cline.OpenRouterModelInfo{}

	if val, ok := data["description"].(string); ok {
		info.Description = &val
	}
	if val, ok := data["contextWindow"].(float64); ok {
		contextWindow := int64(val)
		info.ContextWindow = &contextWindow
	}
	if val, ok := data["maxTokens"].(float64); ok {
		maxTokens := int64(val)
		info.MaxTokens = &maxTokens
	}
	if val, ok := data["inputPrice"].(float64); ok {
		info.InputPrice = &val
	}
	if val, ok := data["outputPrice"].(float64); ok {
		info.OutputPrice = &val
	}
	if val, ok := data["cacheWritesPrice"].(float64); ok {
		info.CacheWritesPrice = &val
	}
	if val, ok := data["cacheReadsPrice"].(float64); ok {
		info.CacheReadsPrice = &val
	}
	if val, ok := data["supportsImages"].(bool); ok {
		info.SupportsImages = &val
	}
	if val, ok := data["supportsPromptCache"].(bool); ok {
		info.SupportsPromptCache = val
	}

	return info
}

// handleRemoveProvider allows removing a configured provider by clearing its API key
func (pw *ProviderWizard) handleRemoveProvider() error {
	// Step 1: Get current provider configurations
	result, err := GetProviderConfigurations(pw.ctx, pw.manager)
	if err != nil {
		return fmt.Errorf("failed to retrieve provider configurations: %w", err)
	}

	// Step 2: Get all ready providers
	readyProviders := result.GetAllReadyProviders()

	// Filter out Cline provider (uses account auth, not API keys)
	var removableProviders []*ProviderDisplay
	for _, provider := range readyProviders {
		if provider.Provider != cline.ApiProvider_CLINE {
			removableProviders = append(removableProviders, provider)
		}
	}

	// Step 3: Check if there are providers to remove
	if len(removableProviders) == 0 {
		fmt.Println("\nNo providers available to remove.")
		fmt.Println("Note: Cline provider cannot be removed via this menu.")
		return nil
	}

	// Step 4: Display selection menu
	var selectedIndex int
	options := make([]huh.Option[int], len(removableProviders))
	for i, provider := range removableProviders {
		// Mark active provider
		displayName := GetProviderDisplayName(provider.Provider)
		if result.ActProvider != nil && provider.Provider == result.ActProvider.Provider {
			displayName += " (ACTIVE)"
		}
		options[i] = huh.NewOption(displayName, i)
	}

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[int]().
				Title("Select provider to remove").
				Options(options...).
				Value(&selectedIndex),
		),
	)

	if err := form.Run(); err != nil {
		return fmt.Errorf("failed to select provider: %w", err)
	}

	selectedProvider := removableProviders[selectedIndex]

	// Step 5: Check if trying to remove the active provider
	if result.ActProvider != nil && selectedProvider.Provider == result.ActProvider.Provider {
		fmt.Printf("\nCannot remove %s because it is currently active.\n", GetProviderDisplayName(selectedProvider.Provider))
		fmt.Println("Please switch to a different provider first, then try again.")
		return nil
	}

	// Step 6: Confirm removal
	var confirm bool
	confirmForm := huh.NewForm(
		huh.NewGroup(
			huh.NewConfirm().
				Title(fmt.Sprintf("Are you sure you want to remove %s?", GetProviderDisplayName(selectedProvider.Provider))).
				Description("This will clear the API key but preserve the model configuration.").
				Value(&confirm),
		),
	)

	if err := confirmForm.Run(); err != nil {
		return fmt.Errorf("failed to get confirmation: %w", err)
	}

	if !confirm {
		fmt.Println("Removal cancelled.")
		return nil
	}

	// Step 7: If removing OCA, sign out first
	if selectedProvider.Provider == cline.ApiProvider_OCA {
		if err := signOutOca(pw.ctx); err != nil {
			fmt.Printf("Warning: Failed to sign out of OCA: %v\n", err)
		} else {
			fmt.Println("Signed out of OCA.")
		}
	}

	// Step 8: Clear the API key for the selected provider
	if err := pw.clearProviderAPIKey(selectedProvider.Provider); err != nil {
		return fmt.Errorf("failed to remove provider: %w", err)
	}

	fmt.Printf("\n✓ %s removed successfully\n", GetProviderDisplayName(selectedProvider.Provider))
	return nil
}

// clearProviderAPIKey clears the API key field for a specific provider using RemoveProviderPartial
func (pw *ProviderWizard) clearProviderAPIKey(provider cline.ApiProvider) error {
	return RemoveProviderPartial(pw.ctx, pw.manager, provider)
}


func signOutOca(ctx context.Context) error {
	client, err := global.GetDefaultClient(ctx)
	if err != nil {
		return err
	}
	_, err = client.Ocaaccount.OcaAccountLogoutClicked(ctx, &cline.EmptyRequest{})
	return err
}

func setWelcomeViewCompleted(ctx context.Context, manager *task.Manager) error {
	_, err := manager.GetClient().State.SetWelcomeViewCompleted(ctx, &cline.BooleanRequest{Value: true})
	return err
}
