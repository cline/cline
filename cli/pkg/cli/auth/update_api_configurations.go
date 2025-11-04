package auth

import (
	"context"
	"fmt"

	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/cli/pkg/cli/task"
	"github.com/cline/grpc-go/cline"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
)

// updateApiConfigurationPartial is a helper that calls the gRPC method with optional verbose logging.
// This replaces the Manager.updateApiConfigurationPartial method to keep auth-specific code in the auth package.
func updateApiConfigurationPartial(ctx context.Context, manager *task.Manager, request *cline.UpdateApiConfigurationPartialRequest) error {
	if global.Config.Verbose {
		fmt.Println("[DEBUG] Updating API configuration (partial)")
		if request.UpdateMask != nil && len(request.UpdateMask.Paths) > 0 {
			fmt.Printf("[DEBUG] Field mask paths: %v\n", request.UpdateMask.Paths)
		}
		if request.ApiConfiguration != nil {
			apiConfig := request.ApiConfiguration
			if apiConfig.PlanModeApiProvider != nil {
				fmt.Printf("[DEBUG] Plan mode provider: %s\n", *apiConfig.PlanModeApiProvider)
			}
			if apiConfig.ActModeApiProvider != nil {
				fmt.Printf("[DEBUG] Act mode provider: %s\n", *apiConfig.ActModeApiProvider)
			}
		}
	}

	// Call the Models service to update API configuration
	_, err := manager.GetClient().Models.UpdateApiConfigurationPartial(ctx, request)
	if err != nil {
		return fmt.Errorf("failed to update API configuration (partial): %w", err)
	}

	if global.Config.Verbose {
		fmt.Println("[DEBUG] API configuration updated successfully (partial)")
	}

	return nil
}

// ProviderFields defines all the field names associated with a specific provider
type ProviderFields struct {
	APIKeyField            string // API key field name (e.g., "apiKey", "openAiApiKey")
	BaseURLField           string // Base URL field name (optional, empty if not applicable)
	PlanModeModelIDField   string // Plan mode model ID field (e.g., "planModeApiModelId")
	ActModeModelIDField    string // Act mode model ID field (e.g., "actModeApiModelId")
	PlanModeModelInfoField string // Plan mode model info field (optional, empty if not applicable)
	ActModeModelInfoField  string // Act mode model info field (optional, empty if not applicable)
	// Provider-specific additional model ID fields
	PlanModeProviderSpecificModelIDField string // e.g., "planModeOpenRouterModelId"
	ActModeProviderSpecificModelIDField  string // e.g., "actModeOpenRouterModelId"
}

// GetProviderFields returns the field mapping for a given provider
func GetProviderFields(provider cline.ApiProvider) (ProviderFields, error) {
	switch provider {
	case cline.ApiProvider_ANTHROPIC:
		return ProviderFields{
			APIKeyField:          "apiKey",
			PlanModeModelIDField: "planModeApiModelId",
			ActModeModelIDField:  "actModeApiModelId",
		}, nil

	case cline.ApiProvider_OPENAI:
		return ProviderFields{
			APIKeyField:                          "openAiApiKey",
			BaseURLField:                         "openAiBaseUrl",
			PlanModeModelIDField:                 "planModeApiModelId",
			ActModeModelIDField:                  "actModeApiModelId",
			PlanModeProviderSpecificModelIDField: "planModeOpenAiModelId",
			ActModeProviderSpecificModelIDField:  "actModeOpenAiModelId",
		}, nil

	case cline.ApiProvider_OPENROUTER:
		return ProviderFields{
			APIKeyField:                          "openRouterApiKey",
			PlanModeModelIDField:                 "planModeApiModelId",
			ActModeModelIDField:                  "actModeApiModelId",
			PlanModeModelInfoField:               "planModeOpenRouterModelInfo",
			ActModeModelInfoField:                "actModeOpenRouterModelInfo",
			PlanModeProviderSpecificModelIDField: "planModeOpenRouterModelId",
			ActModeProviderSpecificModelIDField:  "actModeOpenRouterModelId",
		}, nil

	case cline.ApiProvider_XAI:
		return ProviderFields{
			APIKeyField:          "xaiApiKey",
			PlanModeModelIDField: "planModeApiModelId",
			ActModeModelIDField:  "actModeApiModelId",
		}, nil

	case cline.ApiProvider_BEDROCK:
		return ProviderFields{
			APIKeyField:                          "awsAccessKey",
			PlanModeModelIDField:                 "planModeApiModelId",
			ActModeModelIDField:                  "actModeApiModelId",
			PlanModeProviderSpecificModelIDField: "planModeAwsBedrockCustomModelBaseId",
			ActModeProviderSpecificModelIDField:  "actModeAwsBedrockCustomModelBaseId",
		}, nil

	case cline.ApiProvider_GEMINI:
		return ProviderFields{
			APIKeyField:          "geminiApiKey",
			PlanModeModelIDField: "planModeApiModelId",
			ActModeModelIDField:  "actModeApiModelId",
		}, nil

	case cline.ApiProvider_OPENAI_NATIVE:
		return ProviderFields{
			APIKeyField:          "openAiNativeApiKey",
			PlanModeModelIDField: "planModeApiModelId",
			ActModeModelIDField:  "actModeApiModelId",
		}, nil

	case cline.ApiProvider_OLLAMA:
		return ProviderFields{
			APIKeyField:                          "ollamaBaseUrl",
			PlanModeModelIDField:                 "planModeApiModelId",
			ActModeModelIDField:                  "actModeApiModelId",
			PlanModeProviderSpecificModelIDField: "planModeOllamaModelId",
			ActModeProviderSpecificModelIDField:  "actModeOllamaModelId",
		}, nil

	case cline.ApiProvider_CEREBRAS:
		return ProviderFields{
			APIKeyField:          "cerebrasApiKey",
			PlanModeModelIDField: "planModeApiModelId",
			ActModeModelIDField:  "actModeApiModelId",
		}, nil

	case cline.ApiProvider_CLINE:
		return ProviderFields{
			APIKeyField:                          "clineApiKey",
			PlanModeModelIDField:                 "planModeApiModelId",
			ActModeModelIDField:                  "actModeApiModelId",
			PlanModeModelInfoField:               "planModeOpenRouterModelInfo",
			ActModeModelInfoField:                "actModeOpenRouterModelInfo",
			PlanModeProviderSpecificModelIDField: "planModeOpenRouterModelId",
			ActModeProviderSpecificModelIDField:  "actModeOpenRouterModelId",
		}, nil

	case cline.ApiProvider_OCA:
		return ProviderFields{
			APIKeyField:                          "ocaApiKey",
			PlanModeModelIDField:                 "planModeApiModelId",
			ActModeModelIDField:                  "actModeApiModelId",
			PlanModeModelInfoField:               "planModeOcaModelInfo",
			ActModeModelInfoField:                "actModeOcaModelInfo",
			PlanModeProviderSpecificModelIDField: "planModeOcaModelId",
			ActModeProviderSpecificModelIDField:  "actModeOcaModelId",
		}, nil
	case cline.ApiProvider_HICAP:
		return ProviderFields{
			APIKeyField:                          "hicapApiKey",
			PlanModeModelInfoField:               "planModeHicapModelInfo",
			ActModeModelInfoField:                "actModeHicapModelInfo",
			PlanModeProviderSpecificModelIDField: "planModeHicapModelId",
			ActModeProviderSpecificModelIDField:  "actModeHicapModelId",
		}, nil

	default:
		return ProviderFields{}, fmt.Errorf("unsupported provider: %v", provider)
	}
}

// ProviderUpdatesPartial defines optional fields for partial provider updates
// Uses pointers to distinguish between "not provided" and "set to empty"
type ProviderUpdatesPartial struct {
	ModelID      *string     // New model ID (optional)
	APIKey       *string     // New API key (optional)
	ModelInfo    interface{} // New model info (optional, provider-specific)
	BaseURL      *string     // New base URL (optional, e.g., for OCA, Ollama)
	RefreshToken *string     // New refresh token (optional, e.g., for OCA)
	Mode         *string     // New mode (optional, e.g., "internal" or "external" for OCA)
}

// GetModelIDFieldName returns the appropriate model ID field name for a provider and mode.
// This helper centralizes the logic for determining whether to use provider-specific
// or generic model ID fields.
func GetModelIDFieldName(provider cline.ApiProvider, mode string) (string, error) {
	fields, err := GetProviderFields(provider)
	if err != nil {
		return "", err
	}

	if mode == "plan" {
		// Use provider-specific field if available, otherwise use generic field
		if fields.PlanModeProviderSpecificModelIDField != "" {
			return fields.PlanModeProviderSpecificModelIDField, nil
		}
		return fields.PlanModeModelIDField, nil
	}

	// Act mode
	if fields.ActModeProviderSpecificModelIDField != "" {
		return fields.ActModeProviderSpecificModelIDField, nil
	}
	return fields.ActModeModelIDField, nil
}

// buildProviderFieldMask builds a list of camelCase field paths for the field mask.
// When includeProviderEnums is true, the provider enum fields are included (for setting active provider).
// When false, only the data fields are included (for configuring without activating).
func buildProviderFieldMask(fields ProviderFields, includeAPIKey bool, includeModelID bool, includeModelInfo bool, includeBaseURL bool, includeProviderEnums bool) []string {
	var fieldPaths []string

	// Include provider enums if requested (used when setting active provider)
	if includeProviderEnums {
		fieldPaths = append(fieldPaths, "planModeApiProvider", "actModeApiProvider")
	}

	// Add API key field if requested
	if includeAPIKey {
		fieldPaths = append(fieldPaths, fields.APIKeyField)
		// Special case: Bedrock also needs secret key
		if fields.APIKeyField == "awsAccessKey" {
			fieldPaths = append(fieldPaths, "awsSecretKey")
		}
	}

	// Add base URL field if requested and applicable
	if includeBaseURL && fields.BaseURLField != "" {
		fieldPaths = append(fieldPaths, fields.BaseURLField)
	}

	// Add model ID fields if requested
	if includeModelID {
		// Only include provider-specific fields if they exist, otherwise use generic fields
		if fields.PlanModeProviderSpecificModelIDField != "" {
			// Provider has specific fields - use ONLY those
			fieldPaths = append(fieldPaths, fields.PlanModeProviderSpecificModelIDField)
			fieldPaths = append(fieldPaths, fields.ActModeProviderSpecificModelIDField)
		} else {
			// Provider uses generic fields - update those
			fieldPaths = append(fieldPaths, fields.PlanModeModelIDField)
			fieldPaths = append(fieldPaths, fields.ActModeModelIDField)
		}
	}

	// Add model info fields if requested and applicable
	if includeModelInfo && fields.PlanModeModelInfoField != "" {
		fieldPaths = append(fieldPaths, fields.PlanModeModelInfoField)
		fieldPaths = append(fieldPaths, fields.ActModeModelInfoField)
	}

	return fieldPaths
}

// setAPIKeyField sets the appropriate API key field in the config based on the field name
func setAPIKeyField(apiConfig *cline.ModelsApiConfiguration, fieldName string, value *string) {
	switch fieldName {
	case "apiKey":
		apiConfig.ApiKey = value
	case "openAiApiKey":
		apiConfig.OpenAiApiKey = value
	case "openAiNativeApiKey":
		apiConfig.OpenAiNativeApiKey = value
	case "openRouterApiKey":
		apiConfig.OpenRouterApiKey = value
	case "xaiApiKey":
		apiConfig.XaiApiKey = value
	case "awsAccessKey":
		apiConfig.AwsAccessKey = value
	case "geminiApiKey":
		apiConfig.GeminiApiKey = value
	case "ollamaBaseUrl":
		apiConfig.OllamaBaseUrl = value
	case "cerebrasApiKey":
		apiConfig.CerebrasApiKey = value
	case "clineApiKey":
		apiConfig.ClineApiKey = value
	case "ocaApiKey":
		apiConfig.OcaApiKey = value
	case "hicapApiKey":
		apiConfig.HicapApiKey = value
	}
}

// setProviderSpecificModelID sets the appropriate provider-specific model ID fields when possible
func setProviderSpecificModelID(apiConfig *cline.ModelsApiConfiguration, fieldName string, value *string) {
	switch fieldName {
	case "planModeOpenAiModelId":
		apiConfig.PlanModeOpenAiModelId = value
		apiConfig.ActModeOpenAiModelId = value
	case "planModeOpenRouterModelId":
		apiConfig.PlanModeOpenRouterModelId = value
		apiConfig.ActModeOpenRouterModelId = value
	case "planModeOllamaModelId":
		apiConfig.PlanModeOllamaModelId = value
		apiConfig.ActModeOllamaModelId = value
	case "planModeAwsBedrockCustomModelBaseId":
		apiConfig.PlanModeAwsBedrockCustomModelBaseId = value
		apiConfig.ActModeAwsBedrockCustomModelBaseId = value
	case "planModeOcaModelId":
		apiConfig.PlanModeOcaModelId = value
		apiConfig.ActModeOcaModelId = value
	case "planModeHicapModelId":
		apiConfig.PlanModeHicapModelId = value
		apiConfig.ActModeHicapModelId = value
	}
}

// AddProviderPartial configures a new provider with all necessary fields using partial updates.
func AddProviderPartial(ctx context.Context, manager *task.Manager, provider cline.ApiProvider, modelID string, apiKey string, baseURL string, modelInfo interface{}) error {
	// Get field mapping for this provider
	fields, err := GetProviderFields(provider)
	if err != nil {
		return err
	}

	// Build a ModelsApiConfiguration with only the relevant provider fields set
	apiConfig := &cline.ModelsApiConfiguration{}

	// Set API key field
	if apiKey != "" || fields.APIKeyField != "ollamaBaseUrl" {
		setAPIKeyField(apiConfig, fields.APIKeyField, proto.String(apiKey))
	}

	// Set base URL field if provided and applicable
	includeBaseURL := false
	if baseURL != "" && fields.BaseURLField != "" {
		setBaseURLField(apiConfig, fields.BaseURLField, proto.String(baseURL))
		includeBaseURL = true
	}

	// Set model ID fields
	apiConfig.PlanModeApiModelId = proto.String(modelID)
	apiConfig.ActModeApiModelId = proto.String(modelID)

	// Set provider-specific model ID fields if applicable
	if fields.PlanModeProviderSpecificModelIDField != "" {
		setProviderSpecificModelID(apiConfig, fields.PlanModeProviderSpecificModelIDField, proto.String(modelID))
	}

	// Set model info if applicable and provided
	if fields.PlanModeModelInfoField != "" && modelInfo != nil {
		if openRouterInfo, ok := modelInfo.(*cline.OpenRouterModelInfo); ok {
			apiConfig.PlanModeOpenRouterModelInfo = openRouterInfo
			apiConfig.ActModeOpenRouterModelInfo = openRouterInfo
		}
	}

	// Build field mask including all fields we're setting (without provider enums)
	includeModelInfo := fields.PlanModeModelInfoField != "" && modelInfo != nil
	fieldPaths := buildProviderFieldMask(fields, true, true, includeModelInfo, includeBaseURL, false)

	// Create field mask
	fieldMask := &fieldmaskpb.FieldMask{Paths: fieldPaths}

	// Apply the partial update
	request := &cline.UpdateApiConfigurationPartialRequest{
		ApiConfiguration: apiConfig,
		UpdateMask:       fieldMask,
	}

	if err := updateApiConfigurationPartial(ctx, manager, request); err != nil {
		return fmt.Errorf("failed to update API configuration: %w", err)
	}

	return nil
}

// UpdateProviderPartial updates specific fields for an existing provider using partial updates.
// If setAsActive is true, this will also set the provider as the active provider for both Plan and Act modes.
func UpdateProviderPartial(ctx context.Context, manager *task.Manager, provider cline.ApiProvider, updates ProviderUpdatesPartial, setAsActive bool) error {
	// Get field mapping for this provider
	fields, err := GetProviderFields(provider)
	if err != nil {
		return err
	}

	// Build a ModelsApiConfiguration with only the fields being updated
	apiConfig := &cline.ModelsApiConfiguration{}

	// Set provider enum for BOTH Plan and Act modes if setAsActive is true
	if setAsActive {
		apiConfig.PlanModeApiProvider = &provider
		apiConfig.ActModeApiProvider = &provider
	}

	// Track what we're updating for field mask
	includeAPIKey := updates.APIKey != nil
	includeModelID := updates.ModelID != nil
	includeModelInfo := updates.ModelInfo != nil && fields.PlanModeModelInfoField != ""

	// Update API key if provided
	if updates.APIKey != nil {
		setAPIKeyField(apiConfig, fields.APIKeyField, updates.APIKey)
	}

	// Update model ID if provided
	if updates.ModelID != nil {
		// Only set provider-specific fields if they exist, otherwise use generic fields
		if fields.PlanModeProviderSpecificModelIDField != "" {
			setProviderSpecificModelID(apiConfig, fields.PlanModeProviderSpecificModelIDField, updates.ModelID)
		} else {
			// Provider uses generic fields - set those
			apiConfig.PlanModeApiModelId = updates.ModelID
			apiConfig.ActModeApiModelId = updates.ModelID
		}
	}

	// Update model info if provided
	if updates.ModelInfo != nil && fields.PlanModeModelInfoField != "" {
		if openRouterInfo, ok := updates.ModelInfo.(*cline.OpenRouterModelInfo); ok {
			apiConfig.PlanModeOpenRouterModelInfo = openRouterInfo
			apiConfig.ActModeOpenRouterModelInfo = openRouterInfo
		}
	}

	// Build field mask for only the fields being updated
	fieldPaths := buildProviderFieldMask(fields, includeAPIKey, includeModelID, includeModelInfo, false, setAsActive)

	// Create field mask
	fieldMask := &fieldmaskpb.FieldMask{Paths: fieldPaths}

	// Apply the partial update
	request := &cline.UpdateApiConfigurationPartialRequest{
		ApiConfiguration: apiConfig,
		UpdateMask:       fieldMask,
	}

	if err := updateApiConfigurationPartial(ctx, manager, request); err != nil {
		return fmt.Errorf("failed to update API configuration: %w", err)
	}

	return nil
}

// RemoveProviderPartial removes a provider by clearing its API key using partial updates
func RemoveProviderPartial(ctx context.Context, manager *task.Manager, provider cline.ApiProvider) error {
	// Get field mapping for this provider
	fields, err := GetProviderFields(provider)
	if err != nil {
		return err
	}

	// Build an EMPTY ModelsApiConfiguration (or one with empty API key field)
	// Fields in the mask without values will be cleared
	apiConfig := &cline.ModelsApiConfiguration{}

	// Build field mask with only the API key field(s)
	// For Bedrock, include both access key and secret key
	fieldPaths := []string{fields.APIKeyField}
	if provider == cline.ApiProvider_BEDROCK {
		fieldPaths = append(fieldPaths, "awsSecretKey")
	}

	// Create field mask
	fieldMask := &fieldmaskpb.FieldMask{Paths: fieldPaths}

	// Apply the partial update (clearing API key by including in mask without value)
	request := &cline.UpdateApiConfigurationPartialRequest{
		ApiConfiguration: apiConfig,
		UpdateMask:       fieldMask,
	}

	if err := updateApiConfigurationPartial(ctx, manager, request); err != nil {
		return fmt.Errorf("failed to update API configuration: %w", err)
	}

	return nil
}

// setBaseURLField sets the appropriate base URL field in the config based on the field name
func setBaseURLField(apiConfig *cline.ModelsApiConfiguration, fieldName string, value *string) {
	switch fieldName {
	case "ocaBaseUrl":
		apiConfig.OcaBaseUrl = value
	case "ollamaBaseUrl":
		apiConfig.OllamaBaseUrl = value
	case "openAiBaseUrl":
		apiConfig.OpenAiBaseUrl = value
	case "geminiBaseUrl":
		apiConfig.GeminiBaseUrl = value
	case "liteLlmBaseUrl":
		apiConfig.LiteLlmBaseUrl = value
	case "anthropicBaseUrl":
		apiConfig.AnthropicBaseUrl = value
	case "requestyBaseUrl":
		apiConfig.RequestyBaseUrl = value
	case "lmStudioBaseUrl":
		apiConfig.LmStudioBaseUrl = value
	case "oca":
		apiConfig.OcaBaseUrl = value
	}
}

// setRefreshTokenField sets the appropriate refresh token field in the config
func setRefreshTokenField(apiConfig *cline.ModelsApiConfiguration, fieldName string, value *string) {
	switch fieldName {
	case "ocaRefreshToken":
		apiConfig.OcaRefreshToken = value
	}
}

// setModeField sets the appropriate mode field in the config
func setModeField(apiConfig *cline.ModelsApiConfiguration, fieldName string, value *string) {
	switch fieldName {
	case "ocaMode":
		apiConfig.OcaMode = value
	}
}

// BedrockOptionalFields holds optional configuration fields for AWS Bedrock
type BedrockOptionalFields struct {
	SessionToken            *string // Optional: AWS session token for temporary credentials
	Region                  *string // Optional: AWS region
	UseCrossRegionInference *bool   // Optional: Enable cross-region inference
	UseGlobalInference      *bool   // Optional: Use global inference endpoint
	UsePromptCache          *bool   // Optional: Enable prompt caching
	Authentication          *string // Optional: Authentication method
	UseProfile              *bool   // Optional: Use AWS profile
	Profile                 *string // Optional: AWS profile name
	Endpoint                *string // Optional: Custom endpoint URL
}

// OcaOptionalFields holds optional configuration fields for Oracle Code Assist
type OcaOptionalFields struct {
	BaseURL *string // Optional: Base URL
	Mode    *string // Optional: Mode ("internal" or "external")
}

// setBedrockOptionalFields sets optional Bedrock-specific fields in the API configuration
func setBedrockOptionalFields(apiConfig *cline.ModelsApiConfiguration, fields *BedrockOptionalFields) {
	if fields == nil {
		return
	}

	if fields.SessionToken != nil {
		apiConfig.AwsSessionToken = fields.SessionToken
	}
	if fields.Region != nil {
		apiConfig.AwsRegion = fields.Region
	}
	if fields.UseCrossRegionInference != nil {
		apiConfig.AwsUseCrossRegionInference = fields.UseCrossRegionInference
	}
	if fields.UseGlobalInference != nil {
		apiConfig.AwsUseGlobalInference = fields.UseGlobalInference
	}
	if fields.UsePromptCache != nil {
		apiConfig.AwsBedrockUsePromptCache = fields.UsePromptCache
	}
	if fields.Authentication != nil {
		apiConfig.AwsAuthentication = fields.Authentication
	}
	if fields.UseProfile != nil {
		apiConfig.AwsUseProfile = fields.UseProfile
	}
	if fields.Profile != nil {
		apiConfig.AwsProfile = fields.Profile
	}
	if fields.Endpoint != nil {
		apiConfig.AwsBedrockEndpoint = fields.Endpoint
	}
}

// setOcaOptionalFields sets optional Oca-specific fields in the API configuration
func setOcaOptionalFields(apiConfig *cline.ModelsApiConfiguration, fields *OcaOptionalFields) {
	if fields == nil {
		return
	}

	if fields.Mode != nil {
		apiConfig.OcaMode = fields.Mode
	}
	if fields.BaseURL != nil {
		apiConfig.OcaBaseUrl = fields.BaseURL
	}
}

// buildBedrockOptionalFieldMask builds field mask paths for Bedrock optional fields that have values
func buildBedrockOptionalFieldMask(fields *BedrockOptionalFields) []string {
	if fields == nil {
		return nil
	}

	var fieldPaths []string

	if fields.SessionToken != nil {
		fieldPaths = append(fieldPaths, "awsSessionToken")
	}
	if fields.Region != nil {
		fieldPaths = append(fieldPaths, "awsRegion")
	}
	if fields.UseCrossRegionInference != nil {
		fieldPaths = append(fieldPaths, "awsUseCrossRegionInference")
	}
	if fields.UseGlobalInference != nil {
		fieldPaths = append(fieldPaths, "awsUseGlobalInference")
	}
	if fields.UsePromptCache != nil {
		fieldPaths = append(fieldPaths, "awsBedrockUsePromptCache")
	}
	if fields.Authentication != nil {
		fieldPaths = append(fieldPaths, "awsAuthentication")
	}
	if fields.UseProfile != nil {
		fieldPaths = append(fieldPaths, "awsUseProfile")
	}
	if fields.Profile != nil {
		fieldPaths = append(fieldPaths, "awsProfile")
	}
	if fields.Endpoint != nil {
		fieldPaths = append(fieldPaths, "awsBedrockEndpoint")
	}

	return fieldPaths
}

// buildOcaOptionalFieldMask builds field mask paths for Bedrock optional fields that have values
func buildOcaOptionalFieldMask(fields *OcaOptionalFields) []string {
	if fields == nil {
		return nil
	}

	var fieldPaths []string

	if fields.Mode != nil {
		fieldPaths = append(fieldPaths, "ocaMode")
	}
	if fields.BaseURL != nil {
		fieldPaths = append(fieldPaths, "ocaBaseUrl")
	}

	return fieldPaths
}
