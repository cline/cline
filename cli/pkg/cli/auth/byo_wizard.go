package auth

import (
	"context"
	"fmt"

	"github.com/charmbracelet/huh"
	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/cli/pkg/cli/task"
	"github.com/cline/grpc-go/cline"
)

// Enabled providers for CLI configuration
var SupportedProviders = []ProviderOption{
	{Name: "Anthropic", Provider: cline.ApiProvider_ANTHROPIC},
	{Name: "OpenAI", Provider: cline.ApiProvider_OPENAI},
	{Name: "OpenAI Native", Provider: cline.ApiProvider_OPENAI_NATIVE},
	{Name: "OpenRouter", Provider: cline.ApiProvider_OPENROUTER},
	{Name: "X AI (Grok)", Provider: cline.ApiProvider_XAI},
	{Name: "AWS Bedrock", Provider: cline.ApiProvider_BEDROCK},
	{Name: "Google Gemini", Provider: cline.ApiProvider_GEMINI},
	{Name: "Ollama", Provider: cline.ApiProvider_OLLAMA},
}

// ProviderOption represents a selectable provider in the wizard
type ProviderOption struct {
	Name     string
	Provider cline.ApiProvider
}

// ProviderWizard handles the interactive provider configuration process
type ProviderWizard struct {
	ctx     context.Context
	manager *task.Manager
	config  ProviderConfig
}

// NewProviderWizard creates a new provider configuration wizard
func NewProviderWizard(ctx context.Context) (*ProviderWizard, error) {
	// Ensure a Cline Core instance is running
	if err := global.EnsureDefaultInstance(ctx); err != nil {
		return nil, fmt.Errorf("failed to ensure Cline Core instance: %w", err)
	}

	manager, err := task.NewManagerForDefault(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create task manager: %w", err)
	}

	return &ProviderWizard{
		ctx:     ctx,
		manager: manager,
	}, nil
}

// Run runs the provider configuration wizard
func (pw *ProviderWizard) Run() error {
	fmt.Println("Welcome to Cline API Provider Configuration!")
	fmt.Println()

	for {
		action, err := pw.showMainMenu()
		if err != nil {
			return err
		}

		switch action {
		case "add":
			if err := pw.handleAddProvider(); err != nil {
				return err
			}
		case "select":
			fmt.Println("Provider selection is currently stubbed - not yet implemented.")
		case "remove":
			fmt.Println("Provider removal is currently stubbed - not yet implemented.")
		case "list":
			if err := pw.handleListProviders(); err != nil {
				return err
			}
		case "test":
			fmt.Println("Provider testing is currently stubbed - not yet implemented.")
		case "default":
			fmt.Println("Setting default provider is currently stubbed - not yet implemented.")
		case "save":
			fmt.Println("Configuration saved.")
			return nil
		case "exit":
			fmt.Println("Exiting configuration wizard.")
			return nil
		}
		fmt.Println()
	}
}

// showMainMenu displays the main provider configuration menu
func (pw *ProviderWizard) showMainMenu() (string, error) {
	var action string
	form := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("What would you like to do?").
				Options(
					huh.NewOption("Configure a new provider", "add"),
					huh.NewOption("Select an existing provider", "select"),
					huh.NewOption("Remove a provider", "remove"),
					huh.NewOption("List configured providers", "list"),
					huh.NewOption("Test provider connections", "test"),
					huh.NewOption("Set default provider", "default"),
					huh.NewOption("Save configuration and exit", "save"),
					huh.NewOption("Exit without saving", "exit"),
				).
				Value(&action),
		),
	)

	if err := form.Run(); err != nil {
		return "", fmt.Errorf("failed to get menu choice: %w", err)
	}

	return action, nil
}

// "Add a new provider" > handleAddProvider
func (pw *ProviderWizard) handleAddProvider() error {
	// Step 1: Select provider
	provider, err := pw.selectProvider()
	if err != nil {
		return fmt.Errorf("provider selection failed: %w", err)
	}

	// Step 2: Configure provider (enter model ID and API key)
	modelID, apiKey, err := pw.configureProvider(provider)
	if err != nil {
		return fmt.Errorf("provider configuration failed: %w", err)
	}

	// Step 3: Apply configuration
	config := ProviderConfig{
		Provider: provider,
		ModelID:  modelID,
		APIKey:   apiKey,
	}

	if err := ApplyProviderConfiguration(pw.ctx, pw.manager, config); err != nil {
		return fmt.Errorf("failed to save configuration: %w", err)
	}

	fmt.Println("✓ Provider configured successfully!")
	return nil
}

// Display a list of providers to choose from
func (pw *ProviderWizard) selectProvider() (cline.ApiProvider, error) {
	var selectedIndex int
	
	// Options for huh form
	options := make([]huh.Option[int], len(SupportedProviders))
	for i, provider := range SupportedProviders {
		options[i] = huh.NewOption(provider.Name, i)
	}

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

	return SupportedProviders[selectedIndex].Provider, nil
}

// Form to collect model ID and API key from the user
func (pw *ProviderWizard) configureProvider(provider cline.ApiProvider) (string, string, error) {
	var modelID, apiKey string

	// Provider-specific placeholder model ID
	modelPlaceholder := pw.getModelPlaceholder(provider)

	// Determine field title and behavior based on provider
	var fieldTitle string
	var echoMode huh.EchoMode
	var fieldRequired bool
	
	if provider == cline.ApiProvider_OLLAMA {
		fieldTitle = "Base URL (optional)"
		echoMode = huh.EchoModeNormal
		fieldRequired = false // Base URL is optional, will use default if not provided
	} else {
		fieldTitle = "API Key"
		echoMode = huh.EchoModePassword
		fieldRequired = true
	}

	// Build the apiKeyField input field with conditional validation
	apiKeyField := huh.NewInput().
		Title(fieldTitle).
		EchoMode(echoMode).
		Value(&apiKey)
	
	// Only add validation if the field is required
	if fieldRequired {
		apiKeyField = apiKeyField.Validate(func(s string) error {
			if s == "" {
				return fmt.Errorf("API key cannot be empty")
			}
			return nil
		})
	}

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title("Model ID").
				Placeholder(modelPlaceholder).
				Value(&modelID).
				Validate(func(s string) error {
					if s == "" {
						return fmt.Errorf("model ID cannot be empty")
					}
					return nil
				}),
			apiKeyField,
		),
	)

	if err := form.Run(); err != nil {
		return "", "", fmt.Errorf("failed to get provider configuration: %w", err)
	}

	return modelID, apiKey, nil
}

// handleListProviders retrieves and displays configured providers
func (pw *ProviderWizard) handleListProviders() error {
	// Retrieve configurations from Cline Core
	result, err := GetProviderConfigurations(pw.ctx, pw.manager)
	if err != nil {
		return fmt.Errorf("failed to retrieve provider configurations: %w", err)
	}

	// Format and display the provider list
	output := FormatProviderList(result)
	fmt.Println(output)

	return nil
}

// Provider-specific placeholder model IDs (2025/10/07)
func (pw *ProviderWizard) getModelPlaceholder(provider cline.ApiProvider) string {
	switch provider {
	case cline.ApiProvider_ANTHROPIC:
		return "e.g., claude-sonnet-4-5-20250929"
	case cline.ApiProvider_OPENAI:
		return "e.g., gpt-5-2025-08-07"
	case cline.ApiProvider_OPENAI_NATIVE:
		return "e.g., openai/gpt-oss-120b"
	case cline.ApiProvider_OPENROUTER:
		return "e.g., openai/gpt-oss-120b"
	case cline.ApiProvider_XAI:
		return "e.g., grok-code-fast-1"
	case cline.ApiProvider_BEDROCK:
		return "e.g., anthropic.claude-sonnet-4-5-20250929-v1:0"
	case cline.ApiProvider_GEMINI:
		return "e.g., gemini-2.5-pro"
	case cline.ApiProvider_OLLAMA:
		return "e.g., qwen3-coder:30b"
	default:
		return "Enter model ID"
	}
}
