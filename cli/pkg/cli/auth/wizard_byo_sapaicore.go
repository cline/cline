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
	UseOrchestrationMode         bool   // Optional: Use orchestration mode
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

			huh.NewConfirm().
				Title("Use Orchestration Mode?").
				Value(&config.UseOrchestrationMode).
				Affirmative("Yes").
				Negative("No").
				Inline(true),
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
func ApplySapAiCoreConfig(ctx context.Context, manager *task.Manager, config *SapAiCoreConfig, modelID string, modelInfo interface{}) error {
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

	// Set optional fields if provided
	if config.ResourceGroup != "" {
		apiConfig.SapAiResourceGroup = proto.String(config.ResourceGroup)
	}
	if config.UseOrchestrationMode {
		apiConfig.SapAiCoreUseOrchestrationMode = proto.Bool(true)
	}

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
	}

	// Add optional fields to mask if they were set
	if config.ResourceGroup != "" {
		fieldPaths = append(fieldPaths, "sapAiResourceGroup")
	}
	if config.UseOrchestrationMode {
		fieldPaths = append(fieldPaths, "sapAiCoreUseOrchestrationMode")
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
