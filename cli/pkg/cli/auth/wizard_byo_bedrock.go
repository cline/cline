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

// BedrockConfig holds all AWS Bedrock-specific configuration fields
type BedrockConfig struct {
	AccessKey               string // Required: AWS Access Key
	SecretKey               string // Required: AWS Secret Key
	SessionToken            string // Optional: For temporary credentials
	Region                  string // Optional: AWS region
	UseCrossRegionInference bool   // Optional: Enable cross-region inference
	UseGlobalInference      bool   // Optional: Use global inference endpoint
	UsePromptCache          bool   // Optional: Enable prompt caching
	Authentication          string // Optional: Authentication method
	UseProfile              bool   // Optional: Use AWS profile
	Profile                 string // Optional: AWS profile name
	Endpoint                string // Optional: Custom endpoint URL
}

// PromptForBedrockConfig displays a multi-field form for Bedrock configuration
func PromptForBedrockConfig(ctx context.Context, manager *task.Manager) (*BedrockConfig, error) {
	config := &BedrockConfig{}

	// First, prompt for required fields (access key and secret key)
	requiredForm := huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title("AWS Access Key").
				Value(&config.AccessKey).
				Validate(func(s string) error {
					if strings.TrimSpace(s) == "" {
						return fmt.Errorf("AWS Access Key cannot be empty")
					}
					return nil
				}),

			huh.NewInput().
				Title("AWS Secret Key").
				EchoMode(huh.EchoModePassword).
				Value(&config.SecretKey).
				Validate(func(s string) error {
					if strings.TrimSpace(s) == "" {
						return fmt.Errorf("AWS Secret Key cannot be empty")
					}
					return nil
				}),
		),
	)

	if err := requiredForm.Run(); err != nil {
		return nil, fmt.Errorf("failed to get required Bedrock credentials: %w", err)
	}

	// Trim whitespace from required fields
	config.AccessKey = strings.TrimSpace(config.AccessKey)
	config.SecretKey = strings.TrimSpace(config.SecretKey)

	// Now prompt for all optional fields in a single form
	optionalForm := huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title("Session Token (optional, for temporary credentials)").
				Value(&config.SessionToken).
				Description("Press Enter to skip"),

			huh.NewInput().
				Title("AWS Region (optional, e.g., us-east-1)").
				Value(&config.Region).
				Description("Press Enter to skip"),

			huh.NewInput().
				Title("Authentication Method (optional)").
				Value(&config.Authentication).
				Description("Press Enter to skip"),

			huh.NewInput().
				Title("AWS Profile Name (optional)").
				Value(&config.Profile).
				Description("Required if using AWS Profile, press Enter to skip otherwise"),

			huh.NewInput().
				Title("Custom Endpoint URL (optional)").
				Value(&config.Endpoint).
				Description("Press Enter to skip"),

			huh.NewConfirm().
				Title("Enable Cross-Region Inference?   ").
				Value(&config.UseCrossRegionInference).
				Affirmative("Yes").
				Negative("No").
				Inline(true),

			huh.NewConfirm().
				Title("Use Global Inference Endpoint?   ").
				Value(&config.UseGlobalInference).
				Affirmative("Yes").
				Negative("No").
				Inline(true),

			huh.NewConfirm().
				Title("Enable Prompt Cache?             ").
				Value(&config.UsePromptCache).
				Affirmative("Yes").
				Negative("No").
				Inline(true),

			huh.NewConfirm().
				Title("Use AWS Profile?                 ").
				Value(&config.UseProfile).
				Affirmative("Yes").
				Negative("No").
				Inline(true),
		),
	)

	if err := optionalForm.Run(); err != nil {
		return nil, fmt.Errorf("failed to get optional Bedrock configuration: %w", err)
	}

	// Trim whitespace from optional string fields
	config.SessionToken = strings.TrimSpace(config.SessionToken)
	config.Region = strings.TrimSpace(config.Region)
	config.Authentication = strings.TrimSpace(config.Authentication)
	config.Profile = strings.TrimSpace(config.Profile)
	config.Endpoint = strings.TrimSpace(config.Endpoint)

	return config, nil
}

// ApplyBedrockConfig applies Bedrock configuration using partial updates
func ApplyBedrockConfig(ctx context.Context, manager *task.Manager, config *BedrockConfig, modelID string, modelInfo interface{}) error {
	// Build the API configuration with all Bedrock fields
	apiConfig := &cline.ModelsApiConfiguration{}

	// Set required fields
	apiConfig.AwsAccessKey = proto.String(config.AccessKey)
	apiConfig.AwsSecretKey = proto.String(config.SecretKey)

	// Set model ID fields
	apiConfig.PlanModeApiModelId = proto.String(modelID)
	apiConfig.ActModeApiModelId = proto.String(modelID)
	apiConfig.PlanModeAwsBedrockCustomModelBaseId = proto.String(modelID)
	apiConfig.ActModeAwsBedrockCustomModelBaseId = proto.String(modelID)

	// Set optional fields if provided
	optionalFields := &BedrockOptionalFields{}
	hasOptionalFields := false

	if config.SessionToken != "" {
		optionalFields.SessionToken = proto.String(config.SessionToken)
		hasOptionalFields = true
	}
	if config.Region != "" {
		optionalFields.Region = proto.String(config.Region)
		hasOptionalFields = true
	}
	if config.UseCrossRegionInference {
		optionalFields.UseCrossRegionInference = proto.Bool(true)
		hasOptionalFields = true
	}
	if config.UseGlobalInference {
		optionalFields.UseGlobalInference = proto.Bool(true)
		hasOptionalFields = true
	}
	if config.UsePromptCache {
		optionalFields.UsePromptCache = proto.Bool(true)
		hasOptionalFields = true
	}
	if config.Authentication != "" {
		optionalFields.Authentication = proto.String(config.Authentication)
		hasOptionalFields = true
	}
	if config.UseProfile {
		optionalFields.UseProfile = proto.Bool(true)
		hasOptionalFields = true
	}
	if config.Profile != "" {
		optionalFields.Profile = proto.String(config.Profile)
		hasOptionalFields = true
	}
	if config.Endpoint != "" {
		optionalFields.Endpoint = proto.String(config.Endpoint)
		hasOptionalFields = true
	}

	// Apply optional fields to the config
	if hasOptionalFields {
		setBedrockOptionalFields(apiConfig, optionalFields)
	}

	// Build field mask including all fields we're setting
	fieldPaths := []string{
		"awsAccessKey",
		"awsSecretKey",
		"planModeApiModelId",
		"actModeApiModelId",
		"planModeAwsBedrockCustomModelBaseId",
		"actModeAwsBedrockCustomModelBaseId",
	}

	// Add optional field paths
	if hasOptionalFields {
		optionalPaths := buildBedrockOptionalFieldMask(optionalFields)
		fieldPaths = append(fieldPaths, optionalPaths...)
	}

	// Create field mask
	fieldMask := &fieldmaskpb.FieldMask{Paths: fieldPaths}

	// Apply the partial update
	request := &cline.UpdateApiConfigurationPartialRequest{
		ApiConfiguration: apiConfig,
		UpdateMask:       fieldMask,
	}

	if err := updateApiConfigurationPartial(ctx, manager, request); err != nil {
		return fmt.Errorf("failed to apply Bedrock configuration: %w", err)
	}

	return nil
}
