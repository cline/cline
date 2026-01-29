package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/charmbracelet/huh"
	"github.com/cline/cli/pkg/cli/task"
	"github.com/cline/grpc-go/cline"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
)

type SapAiCoreConfig struct {
	ClientId     string
	ClientSecret string
	BaseUrl      string
	TokenUrl     string

	ResourceGroup        string
	UseOrchestrationMode bool
}

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

func PromptForSapAiCoreConfigWithValidation(existing *SapAiCoreConfig, flags sapExistingFlags) (*SapAiCoreConfig, error) {
	config := &SapAiCoreConfig{}

	if existing != nil {
		config.BaseUrl = existing.BaseUrl
		config.TokenUrl = existing.TokenUrl
		config.ResourceGroup = existing.ResourceGroup
		config.UseOrchestrationMode = existing.UseOrchestrationMode
	}

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
				Description(func() string {
					if flags.HasClientID {
						return "SAP BTP service key 'clientid' field. Already configured."
					}
					return "SAP BTP service key 'clientid' field"
				}()).
				Placeholder(func() string {
					if flags.HasClientID {
						return "(leave empty to keep existing)"
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

			huh.NewInput().
				Title("Client Secret").
				Description(func() string {
					if flags.HasSecret {
						return "SAP BTP service key 'clientsecret' field. Already configured."
					}
					return "SAP BTP service key 'clientsecret' field"
				}()).
				Placeholder(func() string {
					if flags.HasSecret {
						return "(leave empty to keep existing)"
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

	config.UseOrchestrationMode = strings.EqualFold(orchestrationChoice, "Yes")

	optionalForm := huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title("Resource Group (optional)").
				Description("SAP AI Core resource group (default: 'default')").
				Placeholder("e.g., default").
				Value(&config.ResourceGroup),
		),
	)

	if err := optionalForm.Run(); err != nil {
		return nil, fmt.Errorf("failed to get optional SAP AI Core configuration: %w", err)
	}

	config.ClientId = strings.TrimSpace(config.ClientId)
	config.ClientSecret = strings.TrimSpace(config.ClientSecret)
	config.BaseUrl = strings.TrimSpace(config.BaseUrl)
	config.TokenUrl = strings.TrimSpace(config.TokenUrl)
	config.ResourceGroup = strings.TrimSpace(config.ResourceGroup)

	if !flags.HasClientID && config.ClientId == "" {
		return nil, fmt.Errorf("Client ID is required")
	}
	if !flags.HasSecret && config.ClientSecret == "" {
		return nil, fmt.Errorf("Client Secret is required")
	}

	return config, nil
}

func PromptForSapAiCoreConfig() (*SapAiCoreConfig, error) {
	config := &SapAiCoreConfig{}

	var orchestrationChoice string = "No"

	requiredForm := huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title("Client ID").
				Description("SAP BTP service key 'clientid' field").
				Placeholder("e.g., your-client-id").
				EchoMode(huh.EchoModePassword).
				Value(&config.ClientId).
				Validate(func(s string) error {
					if strings.TrimSpace(s) == "" {
						return fmt.Errorf("Client ID is required")
					}
					return nil
				}),

			huh.NewInput().
				Title("Client Secret").
				Description("SAP BTP service key 'clientsecret' field").
				Placeholder("e.g., your-secret").
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

			huh.NewSelect[string]().
				Title("Use Orchestration Mode?").
				Options(huh.NewOptions("Yes", "No")...).
				Value(&orchestrationChoice),
		),
	)

	if err := requiredForm.Run(); err != nil {
		return nil, fmt.Errorf("failed to get required SAP AI Core configuration: %w", err)
	}

	config.UseOrchestrationMode = strings.EqualFold(orchestrationChoice, "Yes")

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

	config.ClientId = strings.TrimSpace(config.ClientId)
	config.ClientSecret = strings.TrimSpace(config.ClientSecret)
	config.BaseUrl = strings.TrimSpace(config.BaseUrl)
	config.TokenUrl = strings.TrimSpace(config.TokenUrl)
	config.ResourceGroup = strings.TrimSpace(config.ResourceGroup)

	return config, nil
}

func ApplySapAiCoreConfig(ctx context.Context, manager *task.Manager, config *SapAiCoreConfig, modelID string, deploymentID string) error {
	apiConfig := &cline.ModelsApiConfiguration{}

	sapAiCoreProvider := cline.ApiProvider_SAPAICORE
	apiConfig.PlanModeApiProvider = &sapAiCoreProvider
	apiConfig.ActModeApiProvider = &sapAiCoreProvider

	apiConfig.SapAiCoreBaseUrl = proto.String(config.BaseUrl)
	apiConfig.SapAiCoreTokenUrl = proto.String(config.TokenUrl)
	apiConfig.SapAiCoreUseOrchestrationMode = proto.Bool(config.UseOrchestrationMode)

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

	apiConfig.PlanModeApiModelId = proto.String(modelID)
	apiConfig.ActModeApiModelId = proto.String(modelID)

	if strings.TrimSpace(config.ResourceGroup) != "" {
		apiConfig.SapAiResourceGroup = proto.String(config.ResourceGroup)
	} else {
		apiConfig.SapAiResourceGroup = nil
	}
	fieldPaths = append(fieldPaths, "sapAiResourceGroup")

	if strings.TrimSpace(deploymentID) != "" {
		apiConfig.PlanModeSapAiCoreDeploymentId = proto.String(deploymentID)
		apiConfig.ActModeSapAiCoreDeploymentId = proto.String(deploymentID)
		fieldPaths = append(fieldPaths, "planModeSapAiCoreDeploymentId", "actModeSapAiCoreDeploymentId")
	}

	fieldMask := &fieldmaskpb.FieldMask{Paths: fieldPaths}

	request := &cline.UpdateApiConfigurationPartialRequest{
		ApiConfiguration: apiConfig,
		UpdateMask:       fieldMask,
	}

	_, err := manager.GetClient().Models.UpdateApiConfigurationPartial(ctx, request)
	if err != nil {
		return fmt.Errorf("failed to update API configuration: %w", err)
	}

	return nil
}

func SetupSapAiCoreWithDynamicModels(ctx context.Context, manager *task.Manager) error {
	existing, flags := LoadExistingSapAiCoreConfig(ctx, manager)
	config, err := PromptForSapAiCoreConfigWithValidation(existing, flags)
	if err != nil {
		return fmt.Errorf("failed to get SAP AI Core configuration: %w", err)
	}

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

	models, _, err := FetchSapAiCoreModels(
		ctx, manager,
		clientIDForFetch,
		clientSecretForFetch,
		config.BaseUrl,
		config.TokenUrl,
		config.ResourceGroup,
	)

	var selectedModel string
	var selectedDeploymentID string

	if err != nil || len(models) == 0 {
		if err != nil {
			fmt.Println("\nUnable to fetch models from SAP AI Core, using default model list...")
			verboseLog("Error: %v", err)
		} else {
			fmt.Println("\nNo running deployments found, using default model list...")
		}

		staticModels, _, staticErr := FetchStaticModels(cline.ApiProvider_SAPAICORE)
		if staticErr != nil {
			return fmt.Errorf("failed to get static models as fallback: %w", staticErr)
		}

		selectedModel, err = DisplayModelSelectionMenu(staticModels, "SAP AI Core")
		if err != nil {
			return fmt.Errorf("failed to select static model: %w", err)
		}
		selectedDeploymentID = ""

	} else {
		selectedDeployment, err := DisplaySapAiCoreDeploymentSelectionMenu(models, "SAP AI Core")
		if err != nil {
			return fmt.Errorf("failed to select dynamic deployment: %w", err)
		}

		selectedModel = selectedDeployment.ModelName
		selectedDeploymentID = selectedDeployment.DeploymentID
	}

	if err := ApplySapAiCoreConfig(ctx, manager, config, selectedModel, selectedDeploymentID); err != nil {
		return fmt.Errorf("failed to apply configuration: %w", err)
	}

	return nil
}
