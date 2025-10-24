package auth

import (
	"context"
	"fmt"
	"os"
	"sort"

	"github.com/charmbracelet/huh"
	"github.com/cline/cli/pkg/cli/task"
	"github.com/cline/grpc-go/cline"
	"golang.org/x/term"
)

// FetchOpenRouterModels fetches available OpenRouter models from Cline Core
func FetchOpenRouterModels(ctx context.Context, manager *task.Manager) (map[string]*cline.OpenRouterModelInfo, error) {
	resp, err := manager.GetClient().Models.RefreshOpenRouterModelsRpc(ctx, &cline.EmptyRequest{})
	if err != nil {
		return nil, fmt.Errorf("failed to fetch OpenRouter models: %w", err)
	}
	return resp.Models, nil
}

// FetchOcaModels fetches available Oca models from Cline Core
func FetchOcaModels(ctx context.Context, manager *task.Manager) (map[string]*cline.OcaModelInfo, error) {
	resp, err := manager.GetClient().Models.RefreshOcaModels(ctx, &cline.StringRequest{})
	if err != nil {
		return nil, fmt.Errorf("failed to fetch Oca models: %w", err)
	}
	return resp.Models, nil
}

// ConvertOpenRouterModelsToInterface converts OpenRouter model map to generic interface map.
// This allows OpenRouter and Cline models to be used with the generic fetching utilities.
func ConvertOpenRouterModelsToInterface(models map[string]*cline.OpenRouterModelInfo) map[string]interface{} {
	result := make(map[string]interface{}, len(models))
	for k, v := range models {
		result[k] = v
	}
	return result
}


// FetchOpenAiModels fetches available OpenAI models from Cline Core
// Takes the API key and returns a list of model IDs
func FetchOpenAiModels(ctx context.Context, manager *task.Manager, baseURL, apiKey string) ([]string, error) {
	req := &cline.OpenAiModelsRequest{
		BaseUrl: baseURL,
		ApiKey:  apiKey,
	}

	resp, err := manager.GetClient().Models.RefreshOpenAiModels(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch OpenAI models: %w", err)
	}
	return resp.Values, nil
}

// FetchOllamaModels fetches available Ollama models from Cline Core
// Takes the base URL (empty string for default) and returns a list of model IDs
func FetchOllamaModels(ctx context.Context, manager *task.Manager, baseURL string) ([]string, error) {
	req := &cline.StringRequest{
		Value: baseURL,
	}

	resp, err := manager.GetClient().Models.GetOllamaModels(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch Ollama models: %w", err)
	}
	return resp.Values, nil
}

// DisplayModelSelectionMenu shows an interactive menu for selecting a model from a list.
// Models are displayed alphabetically. Uses model ID as the option value to avoid
// index-based bugs when list order changes.
// Returns the selected model ID.
func DisplayModelSelectionMenu(models []string, providerName string) (string, error) {
	if len(models) == 0 {
		return "", fmt.Errorf("no models available for selection")
	}

	// Use model ID as the value (not index) to avoid positional coupling bugs
	var selectedModel string
	options := make([]huh.Option[string], len(models))
	for i, model := range models {
		options[i] = huh.NewOption(model, model)
	}

	title := fmt.Sprintf("Select a %s model", providerName)

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title(title).
				Options(options...).
				Height(calculateSelectHeight()).
				Filtering(true).
				Value(&selectedModel),
		),
	)

	if err := form.Run(); err != nil {
		return "", fmt.Errorf("failed to select model: %w", err)
	}

	return selectedModel, nil
}

// ConvertModelsMapToSlice converts a map of models to a sorted slice of model IDs.
// This is useful for displaying models in a consistent order in UI components.
func ConvertModelsMapToSlice(models map[string]interface{}) []string {
	result := make([]string, 0, len(models))
	for modelID := range models {
		result = append(result, modelID)
	}

	// Sort alphabetically for consistent display
	sort.Strings(result)

	return result
}

// ConvertOcaModelsToInterface converts Oca model map to generic interface map.
// This allows Oca and Cline models to be used with the generic fetching utilities.
func ConvertOcaModelsToInterface(models map[string]*cline.OcaModelInfo) map[string]interface{} {
	result := make(map[string]interface{}, len(models))
	for k, v := range models {
		result[k] = v
	}
	return result
}

// getTerminalHeight returns the terminal height (rows)
func getTerminalHeight() int {
	_, height, err := term.GetSize(int(os.Stdout.Fd()))
	if err != nil || height <= 0 {
		return 25 // safe fallback for non-TTY or errors
	}
	return height
}

// calculateSelectHeight computes appropriate height for Select component
// Reserves space for title, search UI, and margins
func calculateSelectHeight() int {
	height := getTerminalHeight()
	// Reserve ~10 rows for UI chrome (title, search, margins)
	visibleRows := height - 10
	// Clamp between 8 (minimum usable) and 25 (maximum before unwieldy)
	if visibleRows < 8 {
		return 8
	}
	if visibleRows > 25 {
		return 25
	}
	return visibleRows
}
