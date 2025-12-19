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
	// Profile authentication fields
	UseProfile bool   // Always true for successful config
	Profile    string // Optional: AWS profile name (empty = default)
	Region     string // Required: AWS region
	Endpoint   string // Optional: Custom VPC endpoint URL

	// Optional features
	UseCrossRegionInference bool // Optional: Enable cross-region inference
	UseGlobalInference      bool // Optional: Use global inference endpoint
	UsePromptCache          bool // Optional: Enable prompt caching

	// Authentication method (always "profile")
	Authentication string // Always set to "profile"

	// Legacy fields (no longer used in profile-only flow)
	AccessKey    string // No longer used
	SecretKey    string // No longer used
	SessionToken string // No longer used
}

// PromptForBedrockConfig displays a profile-first authentication form for Bedrock configuration
func PromptForBedrockConfig(ctx context.Context, manager *task.Manager) (*BedrockConfig, error) {
	config := &BedrockConfig{}

	// First, ask if user wants to use AWS profile authentication
	var useProfile bool
	profileQuestion := huh.NewForm(
		huh.NewGroup(
			huh.NewConfirm().
				Title("Do you want to use an AWS profile for authentication?").
				Description("AWS profiles are managed via 'aws configure'").
				Value(&useProfile).
				Affirmative("Yes").
				Negative("No").
				Inline(true),
		),
	)

	if err := profileQuestion.Run(); err != nil {
		return nil, fmt.Errorf("failed to get authentication method: %w", err)
	}

	// If user declines profile authentication, show message and return error
	if !useProfile {
		fmt.Println("\nAWS profile authentication is currently the only supported method in the CLI.")
		fmt.Println("Please configure an AWS profile using 'aws configure' and try again.")
		return nil, fmt.Errorf("user declined profile authentication")
	}

	// User wants profile auth - collect profile configuration
	config.UseProfile = true
	config.Authentication = "profile"

	// Collect profile name, region, and optional settings
	configForm := huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title("AWS Profile Name (optional, press Enter for default profile)").
				Value(&config.Profile).
				Description("Leave empty to use default AWS profile"),

			huh.NewInput().
				Title("AWS Region (required, e.g., us-east-1)").
				Value(&config.Region).
				Validate(func(s string) error {
					if strings.TrimSpace(s) == "" {
						return fmt.Errorf("AWS Region is required")
					}
					return nil
				}),

			huh.NewInput().
				Title("Custom VPC Endpoint URL (optional)").
				Value(&config.Endpoint).
				Description("Press Enter to skip"),

			huh.NewConfirm().
				Title("Enable Prompt Cache?             ").
				Value(&config.UsePromptCache).
				Affirmative("Yes").
				Negative("No").
				Inline(true),

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
		),
	)

	if err := configForm.Run(); err != nil {
		return nil, fmt.Errorf("failed to get Bedrock configuration: %w", err)
	}

	// Trim whitespace from string fields
	config.Profile = strings.TrimSpace(config.Profile)
	config.Region = strings.TrimSpace(config.Region)
	config.Endpoint = strings.TrimSpace(config.Endpoint)

	return config, nil
}

// ApplyBedrockConfig applies Bedrock configuration using partial updates (profile-only)
func ApplyBedrockConfig(ctx context.Context, manager *task.Manager, config *BedrockConfig, modelID string, modelInfo interface{}) error {
	// Build the API configuration with all Bedrock fields
	apiConfig := &cline.ModelsApiConfiguration{}

	// Set provider for both Plan and Act modes
	bedrockProvider := cline.ApiProvider_BEDROCK
	apiConfig.PlanModeApiProvider = &bedrockProvider
	apiConfig.ActModeApiProvider = &bedrockProvider

	// Set model ID field - this is the primary model ID used by Cline Core
	apiConfig.PlanModeApiModelId = proto.String(modelID)
	apiConfig.ActModeApiModelId = proto.String(modelID)
	apiConfig.PlanModeAwsBedrockCustomModelBaseId = proto.String(modelID)
	apiConfig.ActModeAwsBedrockCustomModelBaseId = proto.String(modelID)

	// Set profile authentication fields (always required)
	optionalFields := &BedrockOptionalFields{}
	optionalFields.Authentication = proto.String("profile")
	optionalFields.UseProfile = proto.Bool(true)
	optionalFields.Region = proto.String(config.Region)

	// Set profile name (can be empty for default profile)
	if config.Profile != "" {
		optionalFields.Profile = proto.String(config.Profile)
	}

	// Set optional fields if provided
	if config.Endpoint != "" {
		optionalFields.Endpoint = proto.String(config.Endpoint)
	}
	if config.UseCrossRegionInference {
		optionalFields.UseCrossRegionInference = proto.Bool(true)
	}
	if config.UseGlobalInference {
		optionalFields.UseGlobalInference = proto.Bool(true)
	}
	if config.UsePromptCache {
		optionalFields.UsePromptCache = proto.Bool(true)
	}

	// Apply all fields to the config
	setBedrockOptionalFields(apiConfig, optionalFields)

	// Build field mask including all fields we're setting (excluding access keys)
	fieldPaths := []string{
		"planModeApiProvider",
		"actModeApiProvider",
		"planModeApiModelId",
		"actModeApiModelId",
		"planModeAwsBedrockCustomModelBaseId",
		"actModeAwsBedrockCustomModelBaseId",
	}

	// Add profile authentication field paths
	optionalPaths := buildBedrockOptionalFieldMask(optionalFields)
	fieldPaths = append(fieldPaths, optionalPaths...)

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
