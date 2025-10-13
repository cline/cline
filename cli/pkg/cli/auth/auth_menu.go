package auth

import (
	"context"
	"fmt"

	"github.com/charmbracelet/huh"
	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/cli/pkg/cli/task"
	"github.com/cline/grpc-go/cline"
)

// AuthAction represents the type of authentication action
type AuthAction string

const (
	AuthActionClineLogin          AuthAction = "cline_login"
	AuthActionBYOSetup            AuthAction = "provider_setup"
	AuthActionChangeClineModel    AuthAction = "change_cline_model"
	AuthActionSelectOrganization  AuthAction = "select_organization"
	AuthActionSelectProvider      AuthAction = "select_provider"
	AuthActionExit                AuthAction = "exit_wizard"
)

//  Cline Auth Menu
//  Example Layout
//
//	┃ Cline Account: <authenticated/not authenticated>
//	┃ Active Provider: <provider name or none configured>
//	┃ Active Model: <model name or none configured>
//	┃
//	┃ What would you like to do?
//	┃   Change Cline model (only if authenticated)				- hidden if not authenticated
//	┃   Authenticate with Cline account / Sign out of Cline		- changes based on auth status
//	┃   Select active provider (Cline or BYO)					- always shown. Used to switch between Cline and BYO providers
//	┃   Configure API provider									- always shown. Launches provider setup wizard
//	┃   Exit authorization wizard								- always shown. Exits the auth menu

// Main entry point for handling the `cline auth` command
// HandleAuthCommand routes the auth command based on the number of arguments
func HandleAuthCommand(ctx context.Context, args []string) error {
	switch len(args) {
	case 0:
		// No args: Show menu (ShowAuthMenuNoArgs)
		return HandleAuthMenuNoArgs(ctx)
	case 1:
		// One arg: Provider ID only, prompt for API key
		return QuickAPISetup(args[0], "")
	case 2:
		// Two args: Provider ID and API key
		return QuickAPISetup(args[0], args[1])
	default:
		return fmt.Errorf("quick BYO API setup is currently stubbed - not yet implemented")
	}
}

// HandleAuthMenuNoArgs prepares the auth menu when no arguments are provided
func HandleAuthMenuNoArgs(ctx context.Context) error {
	// Check if Cline is authenticated
	isClineAuth := IsAuthenticated(ctx)

	// Get current provider config for display
	var currentProvider string
	var currentModel string
	if manager, err := createTaskManager(ctx); err == nil {
		if providerList, err := GetProviderConfigurations(ctx, manager); err == nil {
			if providerList.ActProvider != nil {
				currentProvider = getProviderDisplayName(providerList.ActProvider.Provider)
				currentModel = providerList.ActProvider.ModelID
			}
		}
	}

	// Fetch organizations if authenticated
	var hasOrganizations bool
	if isClineAuth {
		if client, err := global.GetDefaultClient(ctx); err == nil {
			if orgsResponse, err := client.Account.GetUserOrganizations(ctx, &cline.EmptyRequest{}); err == nil {
				hasOrganizations = len(orgsResponse.GetOrganizations()) > 0
			}
		}
	}

	action, err := ShowAuthMenuWithStatus(isClineAuth, hasOrganizations, currentProvider, currentModel)
	if err != nil {
		return err
	}

	switch action {
	case AuthActionClineLogin:
		return HandleClineAuth(ctx)
	case AuthActionBYOSetup:
		return HandleAPIProviderSetup(ctx)
	case AuthActionChangeClineModel:
		return HandleChangeClineModel(ctx)
	case AuthActionSelectOrganization:
		return HandleSelectOrganization(ctx)
	case AuthActionSelectProvider:
		return HandleSelectProvider(ctx)
	case AuthActionExit:
		return nil
	default:
		return fmt.Errorf("invalid action")
	}
}

// ShowAuthMenuWithStatus displays the main auth menu with Cline + provider status
func ShowAuthMenuWithStatus(isClineAuthenticated bool, hasOrganizations bool, currentProvider, currentModel string) (AuthAction, error) {
	var action AuthAction
	var options []huh.Option[AuthAction]

	// Build menu options based on authentication status
	if isClineAuthenticated {
		options = []huh.Option[AuthAction]{
			huh.NewOption("Change Cline model", AuthActionChangeClineModel),
		}

		// Add organization selection if user has organizations
		if hasOrganizations {
			options = append(options, huh.NewOption("Select organization", AuthActionSelectOrganization))
		}

		options = append(options,
			huh.NewOption("Sign out of Cline", AuthActionClineLogin),
			huh.NewOption("Select active provider (Cline or BYO)", AuthActionSelectProvider),
			huh.NewOption("Configure API provider", AuthActionBYOSetup),
			huh.NewOption("Exit authorization wizard", AuthActionExit),
		)
	} else {
		options = []huh.Option[AuthAction]{
			huh.NewOption("Authenticate with Cline account", AuthActionClineLogin),
			huh.NewOption("Select active provider (Cline or BYO)", AuthActionSelectProvider),
			huh.NewOption("Configure API provider", AuthActionBYOSetup),
			huh.NewOption("Exit authorization wizard", AuthActionExit),
		}
	}

	// Determine menu title based on status
	var title string

	// Always show Cline authentication status
	if isClineAuthenticated {
		title = "Cline Account: \033[32m✓\033[0m Authenticated\n"
	} else {
		title = "Cline Account: \033[31m✗\033[0m Not authenticated\n"
	}

	// Show active provider and model if configured (regardless of Cline auth status)
	// ANSI color codes: Normal intensity = \033[22m, White = \033[37m, Reset = \033[0m
	if currentProvider != "" && currentModel != "" {
		title += fmt.Sprintf("Active Provider: \033[22m\033[37m%s\033[0m\nActive Model: \033[22m\033[37m%s\033[0m\n", currentProvider, currentModel)
	}

	// Always end with a huh?
	title += "\nWhat would you like to do?"

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[AuthAction]().
				Title(title).
				Options(options...).
				Value(&action),
		),
	)

	if err := form.Run(); err != nil {
		return "", fmt.Errorf("failed to get menu choice: %w", err)
	}

	return action, nil
}

// HandleAPIProviderSetup launches the API provider configuration wizard
func HandleAPIProviderSetup(ctx context.Context) error {
	wizard, err := NewProviderWizard(ctx)
	if err != nil {
		return fmt.Errorf("failed to create provider wizard: %w", err)
	}

	return wizard.Run()
}

// HandleSelectProvider allows users to switch between Cline provider and BYO providers
func HandleSelectProvider(ctx context.Context) error {
	// Get task manager
	manager, err := createTaskManager(ctx)
	if err != nil {
		return fmt.Errorf("failed to create task manager: %w", err)
	}

	// Detect all providers with valid configurations (is an API key present)
	availableProviders, err := DetectAllConfiguredProviders(ctx, manager)
	if err != nil {
		return fmt.Errorf("failed to detect configured providers: %w", err)
	}

	// Build list of available providers
	var providerOptions []huh.Option[string]
	var providerMapping = make(map[string]cline.ApiProvider)

	// Add each configured provider to the selection menu
	for _, provider := range availableProviders {
		providerName := getProviderDisplayName(provider)
		providerKey := fmt.Sprintf("provider_%d", provider)
		providerOptions = append(providerOptions, huh.NewOption(providerName, providerKey))
		providerMapping[providerKey] = provider
	}

	if len(providerOptions) == 0 {
		fmt.Println("No providers available. Please configure a provider first.")
		return HandleAuthMenuNoArgs(ctx)
	}

	if len(providerOptions) == 1 {
		fmt.Println("Only one provider is configured. Configure another provider to switch between them.")
		return HandleAuthMenuNoArgs(ctx)
	}

	providerOptions = append(providerOptions, huh.NewOption("(Cancel)", "cancel"))

	// Show selection menu
	var selected string
	form := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Select which provider to use").
				Options(providerOptions...).
				Value(&selected),
		),
	)

	if err := form.Run(); err != nil {
		return fmt.Errorf("failed to select provider: %w", err)
	}

	if selected == "cancel" {
		return HandleAuthMenuNoArgs(ctx)
	}

	// Get the selected provider
	selectedProvider := providerMapping[selected]

	// Apply the selected provider
	if selectedProvider == cline.ApiProvider_CLINE {
		// Configure Cline as the active provider
		return SelectClineModel(ctx, manager)
	} else {
		// Switch to the selected BYO provider
		return SwitchToBYOProvider(ctx, manager, selectedProvider)
	}
}

// createTaskManager is a helper to create a task manager (avoids import cycles)
func createTaskManager(ctx context.Context) (*task.Manager, error) {
	return task.NewManagerForDefault(ctx)
}

func verboseLog(format string, args ...interface{}) {
	if global.Config != nil && global.Config.Verbose {
		fmt.Printf("[VERBOSE] "+format+"\n", args...)
	}
}
