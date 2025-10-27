package auth

import (
	"context"
	"fmt"
	"strings"

	"github.com/charmbracelet/huh"
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

// PromptForSapAiCoreConfig displays a configuration form for SAP AI Core
func PromptForSapAiCoreConfig() (*SapAiCoreConfig, error) {
	config := &SapAiCoreConfig{}

	// Collect required fields
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

			huh.NewConfirm().
				Title("Use Orchestration Mode?").
				Value(&config.UseOrchestrationMode).
				Affirmative("Yes").
				Negative("No").
				Inline(false),
		),
	)

	if err := requiredForm.Run(); err != nil {
		return nil, fmt.Errorf("failed to get required SAP AI Core configuration: %w", err)
	}

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
	// Build the API configuration with all SAP AI Core fields
	apiConfig := &cline.ModelsApiConfiguration{}

	// Set required authentication fields
	apiConfig.SapAiCoreClientId = proto.String(config.ClientId)
	apiConfig.SapAiCoreClientSecret = proto.String(config.ClientSecret)
	apiConfig.SapAiCoreBaseUrl = proto.String(config.BaseUrl)
	apiConfig.SapAiCoreTokenUrl = proto.String(config.TokenUrl)

	// Set provider enum fields to activate SAP AI Core
	sapAiCoreProvider := cline.ApiProvider_SAPAICORE
	apiConfig.PlanModeApiProvider = &sapAiCoreProvider
	apiConfig.ActModeApiProvider = &sapAiCoreProvider

	// Set model ID fields
	apiConfig.PlanModeApiModelId = proto.String(modelID)
	apiConfig.ActModeApiModelId = proto.String(modelID)

	// Set deployment ID fields if provided
	if deploymentID != "" {
		apiConfig.PlanModeSapAiCoreDeploymentId = proto.String(deploymentID)
		apiConfig.ActModeSapAiCoreDeploymentId = proto.String(deploymentID)
	}

	// Set optional fields if provided
	if config.ResourceGroup != "" {
		apiConfig.SapAiResourceGroup = proto.String(config.ResourceGroup)
	}
	// Always set orchestration mode field (both true and false are valid)
	apiConfig.SapAiCoreUseOrchestrationMode = proto.Bool(config.UseOrchestrationMode)

	// Build field mask including all fields we're setting
	fieldPaths := []string{
		"sapAiCoreClientId",
		"sapAiCoreClientSecret",
		"sapAiCoreBaseUrl",
		"sapAiCoreTokenUrl",
		"planModeApiProvider",
		"actModeApiProvider",
		"planModeApiModelId",
		"actModeApiModelId",
		"sapAiCoreUseOrchestrationMode",
	}

	// Add optional fields to mask if they were set
	if config.ResourceGroup != "" {
		fieldPaths = append(fieldPaths, "sapAiResourceGroup")
	}
	
	// Add deployment ID fields if provided
	if deploymentID != "" {
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
	// Get SAP AI Core configuration
	config, err := PromptForSapAiCoreConfig()
	if err != nil {
		return fmt.Errorf("failed to get SAP AI Core configuration: %w", err)
	}

	// Try to fetch dynamic models
	models, _, err := FetchSapAiCoreModels(
		ctx, manager,
		config.ClientId,
		config.ClientSecret,
		config.BaseUrl,
		config.TokenUrl,
		config.ResourceGroup,
	)

	var selectedModel string
	var selectedDeploymentID string

	if err != nil || len(models) == 0 {
		if err != nil {
			fmt.Println("Unable to fetch live models from SAP AI Core, using default model list...")
		} else {
			fmt.Println("No running deployments found, using default model list...")
		}

		staticModels, _, staticErr := FetchStaticModels(cline.ApiProvider_SAPAICORE)
		if staticErr != nil {
			return fmt.Errorf("failed to get static models as fallback: %w", staticErr)
		}

		selectedModel, err = DisplayModelSelectionMenu(staticModels, "SAP AI Core")
		if err != nil {
			return fmt.Errorf("failed to select static model: %w", err)
		}
		// No deployment ID for static models
		selectedDeploymentID = ""

	} else {
		selectedDeployment, err := DisplaySapAiCoreDeploymentSelectionMenu(models, "SAP AI Core")
		if err != nil {
			return fmt.Errorf("failed to select dynamic deployment: %w", err)
		}
		
		selectedModel = selectedDeployment.ModelName
		selectedDeploymentID = selectedDeployment.DeploymentID
	}

	// Apply the configuration
	if err := ApplySapAiCoreConfig(ctx, manager, config, selectedModel, selectedDeploymentID); err != nil {
		return fmt.Errorf("failed to apply configuration: %w", err)
	}

	return nil
}
