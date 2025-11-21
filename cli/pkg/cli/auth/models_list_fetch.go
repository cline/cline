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

// SapAiCoreDeployment represents a SAP AI Core model deployment with ID and display name
type SapAiCoreDeployment struct {
	ModelName    string
	DeploymentID string
	DisplayName  string // e.g., "claude-4-sonnet (deployment-123)"
}

// FetchSapAiCoreModels fetches available SAP AI Core models from Cline Core
// Takes SAP AI Core configuration and returns deployments and orchestration availability
func FetchSapAiCoreModels(ctx context.Context, manager *task.Manager, clientID, clientSecret, baseURL, tokenURL, resourceGroup string) ([]SapAiCoreDeployment, bool, error) {
	req := &cline.SapAiCoreModelsRequest{
		ClientId:      clientID,
		ClientSecret:  clientSecret,
		BaseUrl:       baseURL,
		TokenUrl:      tokenURL,
		ResourceGroup: resourceGroup,
	}

	resp, err := manager.GetClient().Models.GetSapAiCoreModels(ctx, req)
	if err != nil {
		return nil, false, fmt.Errorf("failed to fetch SAP AI Core models: %w", err)
	}

	// Extract deployment information
	deployments := make([]SapAiCoreDeployment, len(resp.Deployments))
	if len(deployments) == 0 {
		fmt.Errorf("No running deployments found")
		return deployments, resp.OrchestrationAvailable, nil
	}

	for i, deployment := range resp.Deployments {
		// Create a shortened deployment ID for display (last 8 characters)
		shortDeploymentID := deployment.DeploymentId
		if len(shortDeploymentID) > 8 {
			shortDeploymentID = shortDeploymentID[len(shortDeploymentID)-8:]
		}
		
		deployments[i] = SapAiCoreDeployment{
			ModelName:    deployment.ModelName,
			DeploymentID: deployment.DeploymentId,
			DisplayName:  fmt.Sprintf("%s (%s)", deployment.ModelName, shortDeploymentID),
		}
	}

	return deployments, resp.OrchestrationAvailable, nil
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

// DisplaySapAiCoreDeploymentSelectionMenu shows an interactive menu for selecting a SAP AI Core deployment.
// Deployments are displayed with both model name and deployment ID for clarity.
// Separates deployed models from not-deployed models with section headers.
// Returns the selected deployment.
func DisplaySapAiCoreDeploymentSelectionMenu(deployments []SapAiCoreDeployment, providerName string) (SapAiCoreDeployment, error) {
	if len(deployments) == 0 {
		return SapAiCoreDeployment{}, fmt.Errorf("no deployments available for selection")
	}

	// Separate deployments into deployed (has deployment ID) and not deployed (no deployment ID)
	var deployed []SapAiCoreDeployment
	var notDeployed []SapAiCoreDeployment

	for _, deployment := range deployments {
		if deployment.DeploymentID != "" {
			deployed = append(deployed, deployment)
		} else {
			notDeployed = append(notDeployed, deployment)
		}
	}

	// Build options with section separators
	var options []huh.Option[int]
	deploymentIndex := 0

	// Sort each section by model name for consistent display
	sort.Slice(deployed, func(i, j int) bool {
		return deployed[i].ModelName < deployed[j].ModelName
	})

	// Add deployed models section
	if len(deployed) > 0 {
		// Add section separator (disabled option)
		options = append(options, huh.NewOption("── Deployed Models ──", -1).Selected(false))
		
		for _, deployment := range deployed {
			options = append(options, huh.NewOption(deployment.DisplayName, deploymentIndex))
			deploymentIndex++
		}
	}

	sort.Slice(notDeployed, func(i, j int) bool {
		return notDeployed[i].ModelName < notDeployed[j].ModelName
	})

	// Add not deployed models section
	if len(notDeployed) > 0 {
		// Add section separator (disabled option)
		options = append(options, huh.NewOption("── Not Deployed Models ──", -1).Selected(false))
		
		for _, deployment := range notDeployed {
			options = append(options, huh.NewOption(deployment.ModelName, deploymentIndex))
			deploymentIndex++
		}
	}

	// Combine all deployments in order for index mapping
	allDeployments := append(deployed, notDeployed...)

	var selectedIndex int
	title := fmt.Sprintf("Select a %s deployment", providerName)

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[int]().
				Title(title).
				Options(options...).
				Height(calculateSelectHeight()).
				Filtering(true).
				Value(&selectedIndex),
		),
	)

	if err := form.Run(); err != nil {
		return SapAiCoreDeployment{}, fmt.Errorf("failed to select deployment: %w", err)
	}

	// Reject selection of separator headers
	if selectedIndex == -1 {
		return SapAiCoreDeployment{}, fmt.Errorf("invalid selection")
	}

	return allDeployments[selectedIndex], nil
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
