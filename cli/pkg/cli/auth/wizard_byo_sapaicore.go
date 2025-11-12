package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/charmbracelet/huh"
	"github.com/cline/cli/pkg/cli/display"
	"github.com/cline/cli/pkg/cli/task"
	"github.com/cline/grpc-go/cline"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
)

// SapAiCoreConfig holds all SAP AI Core-specific configuration fields
type SapAiCoreConfig struct {
	// Required authentication fields
	ClientId     string // Required: SAP AI Core client ID
	ClientSecret string // Required: SAP AI Core client secret
	BaseUrl      string // Required: SAP AI Core base URL
	TokenUrl     string // Required: SAP AI Core token URL

	// Optional fields
	ResourceGroup                string // Optional: SAP AI resource group
	UseOrchestrationMode         bool   // Use orchestration mode (required: true/false)
}

 // Helpers to load existing SAP AI Core config without exposing sensitive values
type sapExistingFlags struct {
	HasClientID bool
	HasSecret   bool
}

func LoadExistingSapAiCoreConfig(ctx context.Context, manager *task.Manager) (*SapAiCoreConfig, sapExistingFlags) {
	var flags sapExistingFlags
	if manager == nil {
		return nil, flags
	}

	state, err := manager.GetClient().State.GetLatestState(ctx, &cline.EmptyRequest{})
	if err != nil {
		return nil, flags
	}

	var stateData map[string]interface{}
	if err := json.Unmarshal([]byte(state.StateJson), &stateData); err != nil {
		return nil, flags
	}

	apiConfig, ok := stateData["apiConfiguration"].(map[string]interface{})
	if !ok {
		return nil, flags
	}

	cfg := &SapAiCoreConfig{}

	if v, ok := apiConfig["sapAiCoreBaseUrl"].(string); ok {
		cfg.BaseUrl = strings.TrimSpace(v)
	}
	if v, ok := apiConfig["sapAiCoreTokenUrl"].(string); ok {
		cfg.TokenUrl = strings.TrimSpace(v)
	}
	if v, ok := apiConfig["sapAiResourceGroup"].(string); ok {
		cfg.ResourceGroup = strings.TrimSpace(v)
	}
	if v, ok := apiConfig["sapAiCoreUseOrchestrationMode"].(bool); ok {
		cfg.UseOrchestrationMode = v
	}

	// Detect presence of sensitive fields without exposing values
	if v, ok := apiConfig["sapAiCoreClientId"].(string); ok && strings.TrimSpace(v) != "" {
		flags.HasClientID = true
	}
	if v, ok := apiConfig["sapAiCoreClientSecret"].(string); ok && strings.TrimSpace(v) != "" {
		flags.HasSecret = true
	}

	return cfg, flags
}

func getExistingSapAiCoreSensitive(ctx context.Context, manager *task.Manager) (string, string) {
	if manager == nil {
		return "", ""
	}
	state, err := manager.GetClient().State.GetLatestState(ctx, &cline.EmptyRequest{})
	if err != nil {
		return "", ""
	}
	var stateData map[string]interface{}
	if err := json.Unmarshal([]byte(state.StateJson), &stateData); err != nil {
		return "", ""
	}
	apiConfig, ok := stateData["apiConfiguration"].(map[string]interface{})
	if !ok {
		return "", ""
	}
	var clientID, clientSecret string
	if v, ok := apiConfig["sapAiCoreClientId"].(string); ok {
		clientID = strings.TrimSpace(v)
	}
	if v, ok := apiConfig["sapAiCoreClientSecret"].(string); ok {
		clientSecret = strings.TrimSpace(v)
	}
	return clientID, clientSecret
}

// PromptForSapAiCoreConfigWithValidation displays a configuration form for SAP AI Core with enhanced validation
func PromptForSapAiCoreConfigWithValidation(existing *SapAiCoreConfig, flags sapExistingFlags) (*SapAiCoreConfig, error) {
	config := &SapAiCoreConfig{}

	// Prefill non-sensitive fields from existing config if available
	if existing != nil {
		config.BaseUrl = existing.BaseUrl
		config.TokenUrl = existing.TokenUrl
		config.ResourceGroup = existing.ResourceGroup
		config.UseOrchestrationMode = existing.UseOrchestrationMode
	}

	// Enhanced form with better descriptions and examples
	// Prepare left-aligned non-inline select for orchestration mode
	var orchestrationChoice string
	if config.UseOrchestrationMode {
		orchestrationChoice = "Yes"
	} else {
		orchestrationChoice = "No"
	}
	requiredForm := huh.NewForm(
		huh.NewGroup(
			// Client ID (masked; do not display existing)
			huh.NewInput().
				Title("Client ID").
				Description(func() string {
					if flags.HasClientID {
						return "SAP BTP service key 'clientid' field. Already configured."
					}
					return "SAP BTP service key 'clientid' field"
				}()).
				Placeholder(func() string {
					if flags.HasClientID {
						return "•••••• (leave empty to keep existing)"
					}
					return "e.g., your-client-id"
				}()).
				EchoMode(huh.EchoModePassword).
				Value(&config.ClientId).
				Validate(func(s string) error {
					if strings.TrimSpace(s) == "" && !flags.HasClientID {
						return fmt.Errorf("Client ID is required")
					}
					return nil
				}),

			// Client Secret (masked; do not display existing)
			huh.NewInput().
				Title("Client Secret").
				Description(func() string {
					if flags.HasSecret {
						return "SAP BTP service key 'clientsecret' field. Already configured."
					}
					return "SAP BTP service key 'clientsecret' field"
				}()).
				Placeholder(func() string {
					if flags.HasClientID {
						return "•••••• (leave empty to keep existing)"
					}
					return "e.g., your-secret"
				}()).
				EchoMode(huh.EchoModePassword).
				Value(&config.ClientSecret).
				Validate(func(s string) error {
					if strings.TrimSpace(s) == "" && !flags.HasSecret {
						return fmt.Errorf("Client Secret is required")
					}
					return nil
				}),

			// Base URL (prefilled)
			huh.NewInput().
				Title("Base URL").
				Description("SAP AI Core API endpoint").
				Placeholder("e.g., https://api.ai.example.com").
				Value(&config.BaseUrl).
				Validate(func(s string) error {
					s = strings.TrimSpace(s)
					if s == "" {
						return fmt.Errorf("Base URL is required")
					}
					if !strings.HasPrefix(s, "https://") {
						return fmt.Errorf("Base URL must start with 'https://'")
					}
					return nil
				}),

			// Auth URL (prefilled)
			huh.NewInput().
				Title("Auth URL").
				Description("SAP BTP authentication service URL").
				Placeholder("e.g., https://auth.example.com").
				Value(&config.TokenUrl).
				Validate(func(s string) error {
					s = strings.TrimSpace(s)
					if s == "" {
						return fmt.Errorf("Auth URL is required")
					}
					if !strings.HasPrefix(s, "https://") {
						return fmt.Errorf("Auth URL must start with 'https://'")
					}
					return nil
				}),

			// Orchestration mode (prefilled)
			huh.NewSelect[string]().
				Title("Use Orchestration Mode?").
				Description("Use SAP AI Core Orchestration service instead of direct deployments").
				Options(huh.NewOptions("Yes", "No")...).
				Value(&orchestrationChoice),
		),
	)

	if err := requiredForm.Run(); err != nil {
		return nil, fmt.Errorf("failed to get required SAP AI Core configuration: %w", err)
	}

	// Map selection back to boolean
	config.UseOrchestrationMode = strings.EqualFold(orchestrationChoice, "Yes")

	// Collect optional fields
	optionalForm := huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title("Resource Group (optional)").
				Description("SAP AI Core resource group (default: 'default')").
				Placeholder("e.g., default").
				Value(&config.ResourceGroup).
				Description("Press Enter to skip"),
		),
	)

	if err := optionalForm.Run(); err != nil {
		return nil, fmt.Errorf("failed to get optional SAP AI Core configuration: %w", err)
	}

	// Trim whitespace from string fields (do not modify orchestration mode)
	config.ClientId = strings.TrimSpace(config.ClientId)
	config.ClientSecret = strings.TrimSpace(config.ClientSecret)
	config.BaseUrl = strings.TrimSpace(config.BaseUrl)
	config.TokenUrl = strings.TrimSpace(config.TokenUrl)
	config.ResourceGroup = strings.TrimSpace(config.ResourceGroup)

	// Validate based on existence flags (fresh setup requires both)
	if !flags.HasClientID && config.ClientId == "" {
		return nil, fmt.Errorf("Client ID is required")
	}
	if !flags.HasSecret && config.ClientSecret == "" {
		return nil, fmt.Errorf("Client Secret is required")
	}

	// Non-sensitive field validation handled above
	return config, nil
}

// PromptForSapAiCoreConfig displays a configuration form for SAP AI Core
func PromptForSapAiCoreConfig() (*SapAiCoreConfig, error) {
	config := &SapAiCoreConfig{}

	// Collect required fields
	// Prepare left-aligned non-inline select for orchestration mode
	var orchestrationChoice string
	if config.UseOrchestrationMode {
		orchestrationChoice = "Yes"
	} else {
		orchestrationChoice = "No"
	}
	requiredForm := huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title("Client ID").
				Value(&config.ClientId).
				Validate(func(s string) error {
					if strings.TrimSpace(s) == "" {
						return fmt.Errorf("Client ID is required")
					}
					return nil
				}),

			huh.NewInput().
				Title("Client Secret").
				EchoMode(huh.EchoModePassword).
				Value(&config.ClientSecret).
				Validate(func(s string) error {
					if strings.TrimSpace(s) == "" {
						return fmt.Errorf("Client Secret is required")
					}
					return nil
				}),

			huh.NewInput().
				Title("Base URL").
				Value(&config.BaseUrl).
				Validate(func(s string) error {
					if strings.TrimSpace(s) == "" {
						return fmt.Errorf("Base URL is required")
					}
					return nil
				}),

			huh.NewInput().
				Title("Auth URL").
				Value(&config.TokenUrl).
				Validate(func(s string) error {
					if strings.TrimSpace(s) == "" {
						return fmt.Errorf("Auth URL is required")
					}
					return nil
				}),

			huh.NewSelect[string]().
				Title("Use Orchestration Mode?").
				Options(huh.NewOptions("Yes", "No")...).
				// Left-aligned list (not inline)
				Value(&orchestrationChoice),
		),
	)

	if err := requiredForm.Run(); err != nil {
		return nil, fmt.Errorf("failed to get required SAP AI Core configuration: %w", err)
	}

	// Map selection back to boolean
	config.UseOrchestrationMode = strings.EqualFold(orchestrationChoice, "Yes")

	// Collect optional fields
	optionalForm := huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title("Resource Group (optional)").
				Placeholder("e.g., default").
				Value(&config.ResourceGroup).
				Description("Press Enter to skip"),
		),
	)

	if err := optionalForm.Run(); err != nil {
		return nil, fmt.Errorf("failed to get optional SAP AI Core configuration: %w", err)
	}

	// Trim whitespace from string fields
	config.ClientId = strings.TrimSpace(config.ClientId)
	config.ClientSecret = strings.TrimSpace(config.ClientSecret)
	config.BaseUrl = strings.TrimSpace(config.BaseUrl)
	config.TokenUrl = strings.TrimSpace(config.TokenUrl)
	config.ResourceGroup = strings.TrimSpace(config.ResourceGroup)

	return config, nil
}

// ApplySapAiCoreConfig applies SAP AI Core configuration using partial updates
func ApplySapAiCoreConfig(ctx context.Context, manager *task.Manager, config *SapAiCoreConfig, modelID string, deploymentID string) error {
	// Build the API configuration with SAP AI Core fields
	apiConfig := &cline.ModelsApiConfiguration{}

	// Provider enums to activate SAP AI Core
	sapAiCoreProvider := cline.ApiProvider_SAPAICORE
	apiConfig.PlanModeApiProvider = &sapAiCoreProvider
	apiConfig.ActModeApiProvider = &sapAiCoreProvider

	// Always set non-sensitive fields
	apiConfig.SapAiCoreBaseUrl = proto.String(config.BaseUrl)
	apiConfig.SapAiCoreTokenUrl = proto.String(config.TokenUrl)
	apiConfig.SapAiCoreUseOrchestrationMode = proto.Bool(config.UseOrchestrationMode)

	// Conditionally set sensitive fields only if provided (avoid overwriting existing)
	fieldPaths := []string{
		"sapAiCoreBaseUrl",
		"sapAiCoreTokenUrl",
		"planModeApiProvider",
		"actModeApiProvider",
		"planModeApiModelId",
		"actModeApiModelId",
		"sapAiCoreUseOrchestrationMode",
	}

	if strings.TrimSpace(config.ClientId) != "" {
		apiConfig.SapAiCoreClientId = proto.String(config.ClientId)
		fieldPaths = append(fieldPaths, "sapAiCoreClientId")
	}
	if strings.TrimSpace(config.ClientSecret) != "" {
		apiConfig.SapAiCoreClientSecret = proto.String(config.ClientSecret)
		fieldPaths = append(fieldPaths, "sapAiCoreClientSecret")
	}

	// Model IDs (always set)
	apiConfig.PlanModeApiModelId = proto.String(modelID)
	apiConfig.ActModeApiModelId = proto.String(modelID)

	if strings.TrimSpace(config.ResourceGroup) != "" {
		apiConfig.SapAiResourceGroup = proto.String(config.ResourceGroup)
	} else {
		// Set to nil to clear the field when empty
		apiConfig.SapAiResourceGroup = nil
	}
	fieldPaths = append(fieldPaths, "sapAiResourceGroup")

	// Optional deployment IDs
	if strings.TrimSpace(deploymentID) != "" {
		apiConfig.PlanModeSapAiCoreDeploymentId = proto.String(deploymentID)
		apiConfig.ActModeSapAiCoreDeploymentId = proto.String(deploymentID)
		fieldPaths = append(fieldPaths, "planModeSapAiCoreDeploymentId", "actModeSapAiCoreDeploymentId")
	}

	// Create field mask
	fieldMask := &fieldmaskpb.FieldMask{Paths: fieldPaths}

	// Apply the partial update
	request := &cline.UpdateApiConfigurationPartialRequest{
		ApiConfiguration: apiConfig,
		UpdateMask:       fieldMask,
	}

	if err := updateApiConfigurationPartial(ctx, manager, request); err != nil {
		return fmt.Errorf("failed to apply SAP AI Core configuration: %w", err)
	}

	return nil
}

// SetupSapAiCoreWithDynamicModels sets up SAP AI Core with dynamic model fetching
func SetupSapAiCoreWithDynamicModels(ctx context.Context, manager *task.Manager) error {
	// Step 1: Collect configuration with enhanced validation
	existing, flags := LoadExistingSapAiCoreConfig(ctx, manager)
	config, err := PromptForSapAiCoreConfigWithValidation(existing, flags)
	if err != nil {
		return fmt.Errorf("failed to get SAP AI Core configuration: %w", err)
	}

	var selectedModel string
	var selectedDeploymentID string

	// Step 2: Handle orchestration mode differently from non-orchestration mode
	if config.UseOrchestrationMode {
		// In orchestration mode: use static model list only (no deployment fetching)
		renderer := display.NewRenderer("auto")
		fmt.Printf("\n%s\n\n", renderer.Dim("Using orchestration mode - selecting from standard model list"))

		staticModels, _, staticErr := FetchStaticModels(cline.ApiProvider_SAPAICORE)
		if staticErr != nil {
			return fmt.Errorf("failed to get static models: %w", staticErr)
		}

		selectedModel, err = DisplayModelSelectionMenu(staticModels, "SAP AI Core")
		if err != nil {
			return fmt.Errorf("failed to select model: %w", err)
		}
		// No deployment ID needed in orchestration mode
		selectedDeploymentID = ""

	} else {
		// In non-orchestration mode: fetch deployments dynamically and merge with static models
		// Use provided sensitive values, or fall back to existing stored ones if left blank
		clientIDForFetch := strings.TrimSpace(config.ClientId)
		clientSecretForFetch := strings.TrimSpace(config.ClientSecret)
		if (clientIDForFetch == "" || clientSecretForFetch == "") && (flags.HasClientID || flags.HasSecret) {
			existingID, existingSecret := getExistingSapAiCoreSensitive(ctx, manager)
			if clientIDForFetch == "" {
				clientIDForFetch = existingID
			}
			if clientSecretForFetch == "" {
				clientSecretForFetch = existingSecret
			}
		}

		// Fetch dynamic deployments
		dynamicModels, _, err := FetchSapAiCoreModels(
			ctx, manager,
			clientIDForFetch,
			clientSecretForFetch,
			config.BaseUrl,
			config.TokenUrl,
			config.ResourceGroup,
		)

		// Fetch static models
		staticModelIDs, _, staticErr := FetchStaticModels(cline.ApiProvider_SAPAICORE)
		if staticErr != nil {
			return fmt.Errorf("failed to get static models: %w", staticErr)
		}

		// Merge: Add static models that aren't already in the dynamic list
		mergedModels := dynamicModels
		if err == nil && len(dynamicModels) > 0 {
			// Create a map of existing model names for quick lookup
			existingModelNames := make(map[string]bool)
			for _, deployment := range dynamicModels {
				existingModelNames[deployment.ModelName] = true
			}

			// Add static models that don't exist in dynamic deployments
			for _, staticModelID := range staticModelIDs {
				if !existingModelNames[staticModelID] {
					mergedModels = append(mergedModels, SapAiCoreDeployment{
						ModelName:    staticModelID,
						DeploymentID: "", // No deployment ID for static models
						DisplayName:  staticModelID,
					})
				}
			}
		} else {
			// If fetching failed or returned no results, use static models only
			renderer := display.NewRenderer("auto")

			if err != nil {
				warningMsg := "⚠️  Unable to fetch models from SAP AI Core."
				errorMsg := fmt.Sprintf("Error: %s", err.Error())
				fallbackMsg := "Using default model list instead."
				fmt.Printf("\n%s\n", renderer.Yellow(renderer.Bold(warningMsg)))
				fmt.Printf("%s\n", renderer.Red(errorMsg))
				fmt.Printf("%s\n\n", renderer.Dim(fallbackMsg))
			} else {
				warningMsg := "⚠️  No running deployments found in SAP AI Core.\nThis is probably due to a misconfiguration."
				fallbackMsg := "Using default model list instead"
				fmt.Printf("\n%s\n", renderer.Red(renderer.Bold(warningMsg)))
				fmt.Printf("%s\n\n", renderer.Dim(fallbackMsg))
			}

			// Convert static model IDs to deployment structure
			mergedModels = make([]SapAiCoreDeployment, len(staticModelIDs))
			for i, modelID := range staticModelIDs {
				mergedModels[i] = SapAiCoreDeployment{
					ModelName:    modelID,
					DeploymentID: "",
					DisplayName:  modelID,
				}
			}
		}

		// Present merged list to user
		selectedDeployment, err := DisplaySapAiCoreDeploymentSelectionMenu(mergedModels, "SAP AI Core")
		if err != nil {
			return fmt.Errorf("failed to select deployment: %w", err)
		}

		selectedModel = selectedDeployment.ModelName
		selectedDeploymentID = selectedDeployment.DeploymentID
	}

	// Step 3: Apply the configuration
	if err := ApplySapAiCoreConfig(ctx, manager, config, selectedModel, selectedDeploymentID); err != nil {
		return fmt.Errorf("failed to apply configuration: %w", err)
	}

	return nil
}
