package auth

import (
	"context"
	"fmt"

	"github.com/beadsmith/cli/pkg/cli/global"
	"github.com/beadsmith/cli/pkg/cli/task"
	"github.com/beadsmith/grpc-go/beadsmith"
)

// DefaultClineModelID is the default model ID for Beadsmith provider.
// Cline uses OpenRouter-compatible model IDs.
const DefaultClineModelID = "anthropic/claude-sonnet-4.5"

// FetchClineModels fetches available Beadsmith models from Beadsmith Core.
// Note: Beadsmith provider uses OpenRouter-compatible API and model format.
// The models are fetched using the same method as OpenRouter.
func FetchClineModels(ctx context.Context, manager *task.Manager) (map[string]*cline.OpenRouterModelInfo, error) {
	if global.Config.Verbose {
		fmt.Println("Fetching Beadsmith models (using OpenRouter-compatible API)")
	}

	// Cline uses OpenRouter model fetching
	models, err := FetchOpenRouterModels(ctx, manager)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch Beadsmith models: %w", err)
	}

	return models, nil
}

// GetBeadsmithModelInfo retrieves information for a specific Beadsmith model.
func GetBeadsmithModelInfo(modelID string, models map[string]*cline.OpenRouterModelInfo) (*cline.OpenRouterModelInfo, error) {
	modelInfo, exists := models[modelID]
	if !exists {
		return nil, fmt.Errorf("model %s not found", modelID)
	}
	return modelInfo, nil
}

// SetDefaultBeadsmithModel configures the default Beadsmith model after authentication.
// This is called automatically after successful Cline sign-in.
func SetDefaultBeadsmithModel(ctx context.Context, manager *task.Manager) error {

	// Fetch available models
	models, err := FetchClineModels(ctx, manager)
	if err != nil {
		// If we can't fetch models, we'll use the default without model info
		fmt.Printf("Warning: Could not fetch Beadsmith models: %v\n", err)
		fmt.Printf("Using default model: %s\n", DefaultClineModelID)
		return applyDefaultClineModel(ctx, manager, nil)
	}

	// Check if default model is available
	modelInfo, err := GetBeadsmithModelInfo(DefaultClineModelID, models)
	if err != nil {
		fmt.Printf("Warning: Default model not found: %v\n", err)
		// Try to use any available model
		for modelID := range models {
			fmt.Printf("Using available model: %s\n", modelID)
			return applyClineModelConfiguration(ctx, manager, modelID, models[modelID])
		}
		return fmt.Errorf("no usable Beadsmith models found")
	}

	if err := applyClineModelConfiguration(ctx, manager, DefaultClineModelID, modelInfo); err != nil {
		return err
	}

	if err := setWelcomeViewCompletedWithManager(ctx, manager); err != nil {
		verboseLog("Warning: Failed to mark welcome view as completed: %v", err)
	}

	return nil
}

// SelectBeadsmithModel presents a menu to select a Beadsmith model and applies the configuration.
func SelectBeadsmithModel(ctx context.Context, manager *task.Manager) error {

	// Fetch models (uses OpenRouter-compatible format)
	models, err := FetchClineModels(ctx, manager)
	if err != nil {
		return fmt.Errorf("failed to fetch Beadsmith models: %w", err)
	}

	// Convert to interface map for generic utilities
	modelMap := ConvertOpenRouterModelsToInterface(models)

	// Get model IDs as a sorted list
	modelIDs := ConvertModelsMapToSlice(modelMap)

	// Display selection menu
	selectedModelID, err := DisplayModelSelectionMenu(modelIDs, "Cline")
	if err != nil {
		return fmt.Errorf("model selection failed: %w", err)
	}

	// Get the selected model info
	modelInfo := models[selectedModelID]

	// Apply the configuration
	if err := applyClineModelConfiguration(ctx, manager, selectedModelID, modelInfo); err != nil {
		return err
	}

	fmt.Println()

	// Return to main auth menu after model selection
	return HandleAuthMenuNoArgs(ctx)
}

// applyClineModelConfiguration applies a Beadsmith model configuration to both Act and Plan modes using UpdateProviderPartial.
// Cline uses OpenRouter-compatible model format.
func applyClineModelConfiguration(ctx context.Context, manager *task.Manager, modelID string, modelInfo *cline.OpenRouterModelInfo) error {
	provider := cline.ApiProvider_CLINE

	updates := ProviderUpdatesPartial{
		ModelID:   &modelID,
		ModelInfo: modelInfo,
	}

	return UpdateProviderPartial(ctx, manager, provider, updates, true)
}

func applyDefaultClineModel(ctx context.Context, manager *task.Manager, modelInfo *cline.OpenRouterModelInfo) error {
	if err := applyClineModelConfiguration(ctx, manager, DefaultClineModelID, modelInfo); err != nil {
		return err
	}

	if err := setWelcomeViewCompletedWithManager(ctx, manager); err != nil {
		verboseLog("Warning: Failed to mark welcome view as completed: %v", err)
	}

	return nil
}

func setWelcomeViewCompletedWithManager(ctx context.Context, manager *task.Manager) error {
	_, err := manager.GetClient().State.SetWelcomeViewCompleted(ctx, &beadsmith.BooleanRequest{Value: true})
	return err
}
