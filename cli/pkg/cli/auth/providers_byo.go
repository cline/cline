package auth

import (
	"fmt"

	"github.com/charmbracelet/huh"
	"github.com/cline/grpc-go/cline"
)

// BYOProviderOption represents a selectable BYO (bring-your-own) provider option
type BYOProviderOption struct {
	Name     string
	Provider cline.ApiProvider
}

// GetBYOProviderList returns the list of supported BYO providers for CLI configuration.
// This list excludes Cline provider which is handled separately.
func GetBYOProviderList() []BYOProviderOption {
	return []BYOProviderOption{
		{Name: "Anthropic", Provider: cline.ApiProvider_ANTHROPIC},
		{Name: "OpenAI Compatible", Provider: cline.ApiProvider_OPENAI},
		{Name: "OpenAI (Official)", Provider: cline.ApiProvider_OPENAI_NATIVE},
		{Name: "OpenRouter", Provider: cline.ApiProvider_OPENROUTER},
		{Name: "X AI (Grok)", Provider: cline.ApiProvider_XAI},
		{Name: "AWS Bedrock", Provider: cline.ApiProvider_BEDROCK},
		{Name: "Google Gemini", Provider: cline.ApiProvider_GEMINI},
		{Name: "Ollama", Provider: cline.ApiProvider_OLLAMA},
		{Name: "Cerebras", Provider: cline.ApiProvider_CEREBRAS},
		{Name: "NousResearch", Provider: cline.ApiProvider_NOUSRESEARCH},
		{Name: "Oracle Code Assist", Provider: cline.ApiProvider_OCA},
	}
}

// SelectBYOProvider displays a menu for selecting a BYO provider.
func SelectBYOProvider() (cline.ApiProvider, error) {
	providers := GetBYOProviderList()
	var selectedIndex int

	options := make([]huh.Option[int], len(providers)+1)
	for i, provider := range providers {
		options[i] = huh.NewOption(provider.Name, i)
	}
	options[len(providers)] = huh.NewOption("(Cancel)", -1)

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[int]().
				Title("Select an API provider").
				Options(options...).
				Value(&selectedIndex),
		),
	)

	if err := form.Run(); err != nil {
		return 0, fmt.Errorf("failed to select provider: %w", err)
	}

	if selectedIndex == -1 {
		return 0, fmt.Errorf("provider selection cancelled")
	}

	return providers[selectedIndex].Provider, nil
}

// SupportsBYOModelFetching returns true if the provider supports fetching models dynamically
// from a remote API, or if it has a static list of predefined models.
// This is used to determine whether to show a model list before prompting for manual entry.
func SupportsBYOModelFetching(provider cline.ApiProvider) bool {
	switch provider {
	case cline.ApiProvider_OPENROUTER:
		return true
	case cline.ApiProvider_OPENAI:
		return true
	case cline.ApiProvider_OLLAMA:
		return true
	case cline.ApiProvider_OCA:
		return true
	}

	return SupportsStaticModelList(provider)
}

// GetBYOProviderPlaceholder returns a placeholder model ID for manual entry based on provider.
func GetBYOProviderPlaceholder(provider cline.ApiProvider) string {
	switch provider {
	case cline.ApiProvider_ANTHROPIC:
		return "e.g., claude-sonnet-4-5-20250929"
	case cline.ApiProvider_OPENAI:
		return "e.g., openai/gpt-oss-120b"
	case cline.ApiProvider_OPENAI_NATIVE:
		return "e.g., gpt-5-2025-08-07"
	case cline.ApiProvider_OPENROUTER:
		return "e.g., google/gemini-2.0-flash-exp:free"
	case cline.ApiProvider_XAI:
		return "e.g., grok-code-fast-1"
	case cline.ApiProvider_BEDROCK:
		return "e.g., anthropic.claude-sonnet-4-5-20250929-v1:0"
	case cline.ApiProvider_GEMINI:
		return "e.g., gemini-2.5-pro"
	case cline.ApiProvider_OLLAMA:
		return "e.g., qwen3-coder:30b"
	case cline.ApiProvider_CEREBRAS:
		return "e.g., gpt-oss-120b"
	case cline.ApiProvider_NOUSRESEARCH:
		return "e.g., Hermes-4-405B"
	case cline.ApiProvider_OCA:
		return "e.g., oca/llama4"
	default:
		return "Enter model ID"
	}
}

// GetBYOAPIKeyFieldConfig returns field configuration for API key input based on provider.
type APIKeyFieldConfig struct {
	Title      string
	EchoMode   huh.EchoMode
	IsRequired bool
}

// GetBYOAPIKeyFieldConfig returns the configuration for the API key field based on provider.
func GetBYOAPIKeyFieldConfig(provider cline.ApiProvider) APIKeyFieldConfig {
	if provider == cline.ApiProvider_OLLAMA {
		return APIKeyFieldConfig{
			Title:      "Base URL (optional, press Enter for default)",
			EchoMode:   huh.EchoModeNormal,
			IsRequired: false,
		}
	}

	return APIKeyFieldConfig{
		Title:      "API Key",
		EchoMode:   huh.EchoModePassword,
		IsRequired: true,
	}
}

// PromptForAPIKey prompts the user to enter an API key (or base URL for Ollama).
// For OpenAI (Compatible) provider, also prompts for an optional base URL.
func PromptForAPIKey(provider cline.ApiProvider) (string, string, error) {
	var apiKey string
	config := GetBYOAPIKeyFieldConfig(provider)

	apiKeyField := huh.NewInput().
		Title(config.Title).
		EchoMode(config.EchoMode).
		Value(&apiKey)

	if config.IsRequired {
		apiKeyField = apiKeyField.Validate(func(s string) error {
			if s == "" {
				return fmt.Errorf("API key cannot be empty")
			}
			return nil
		})
	}

	form := huh.NewForm(huh.NewGroup(apiKeyField))

	if err := form.Run(); err != nil {
		return "", "", fmt.Errorf("failed to get API key: %w", err)
	}

	// For OpenAI (Compatible) provider, prompt for base URL
	if provider == cline.ApiProvider_OPENAI {
		var baseURL string
		baseURLForm := huh.NewForm(
			huh.NewGroup(
				huh.NewInput().
					Title("Base URL (optional, for OpenAI-compatible providers)").
					Placeholder("e.g., https://api.example.com/v1").
					Value(&baseURL).
					Description("Press Enter to skip if using standard OpenAI API"),
			),
		)

		if err := baseURLForm.Run(); err != nil {
			return "", "", fmt.Errorf("failed to get base URL: %w", err)
		}

		return apiKey, baseURL, nil
	}

	return apiKey, "", nil
}
