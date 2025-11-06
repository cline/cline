package auth

import (
	"context"
	"fmt"

	"github.com/charmbracelet/huh"
	"github.com/cline/cli/pkg/cli/display"
	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/cli/pkg/cli/task"
	"github.com/cline/grpc-go/cline"
)

// contextKey is a distinct type for context keys to avoid collisions
type contextKey string

const authInstanceAddressKey contextKey = "authInstanceAddress"

// AuthAction represents the type of authentication action
type AuthAction string

const (
	AuthActionClineLogin         AuthAction = "cline_login"
	AuthActionBYOSetup           AuthAction = "provider_setup"
	AuthActionChangeClineModel   AuthAction = "change_cline_model"
	AuthActionSelectOrganization AuthAction = "select_organization"
	AuthActionSelectProvider     AuthAction = "select_provider"
	AuthActionExit               AuthAction = "exit_wizard"
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
//	┃   Configure BYO API providers								- always shown. Launches provider setup wizard
//	┃   Exit authorization wizard								- always shown. Exits the auth menu

// RunAuthFlow is the entry point for the entire auth flow with instance management
// It spawns a fresh instance for auth operations and cleans it up when done
func RunAuthFlow(ctx context.Context, args []string) error {
	// Spawn a fresh instance for auth operations
	instanceInfo, err := global.Clients.StartNewInstance(ctx)
	if err != nil {
		return fmt.Errorf("failed to start auth instance: %w", err)
	}

	// Cleanup when done (success, error, or panic)
	defer func() {
		verboseLog("Shutting down auth instance at %s", instanceInfo.Address)
		if err := global.KillInstanceByAddress(context.Background(), global.Clients.GetRegistry(), instanceInfo.Address); err != nil {
			verboseLog("Warning: Failed to kill auth instance: %v", err)
		}
	}()

	// Store instance address in context for all auth handlers to use
	authCtx := context.WithValue(ctx, authInstanceAddressKey, instanceInfo.Address)

	// Route to existing auth flow
	return HandleAuthCommand(authCtx, args)
}

// Main entry point for handling the `cline auth` command
// HandleAuthCommand routes the auth command based on the number of arguments
func HandleAuthCommand(ctx context.Context, args []string) error {

	// Check if flags are provided for quick setup
	if QuickProvider != "" || QuickAPIKey != "" || QuickModelID != "" || QuickBaseURL != "" {
		if QuickProvider == "" || QuickAPIKey == "" || QuickModelID == "" {
			return fmt.Errorf("quick setup requires --provider, --apikey, and --modelid flags. Use 'cline auth --help' for more information")
		}
		return QuickSetupFromFlags(ctx, QuickProvider, QuickAPIKey, QuickModelID, QuickBaseURL)
	}

	switch len(args) {
	case 0:
		// No args: Show uth wizard
		return HandleAuthMenuNoArgs(ctx)
	case 1, 2, 3, 4:
		fmt.Println("Invalid positional arguments. Correct usage:")
		fmt.Println("  cline auth --provider <provider> --apikey <key> --modelid <model> --baseurl <optional>")
		return nil
	default:
		return fmt.Errorf("too many arguments. Use flags for quick setup: --provider, --apikey, --modelid --baseurl(optional)")
	}
}

// getAuthInstanceAddress retrieves the auth instance address from context
// Returns empty string if not found (falls back to default behavior)
func getAuthInstanceAddress(ctx context.Context) string {
	if addr, ok := ctx.Value(authInstanceAddressKey).(string); ok {
		return addr
	}
	return ""
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
				currentProvider = GetProviderDisplayName(providerList.ActProvider.Provider)
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
		// Check if user cancelled - propagate for clean exit
		if err == huh.ErrUserAborted {
			return huh.ErrUserAborted
		}
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
			huh.NewOption("Configure BYO API providers", AuthActionBYOSetup),
			huh.NewOption("Exit authorization wizard", AuthActionExit),
		)
	} else {
		options = []huh.Option[AuthAction]{
			huh.NewOption("Authenticate with Cline account", AuthActionClineLogin),
			huh.NewOption("Select active provider (Cline or BYO)", AuthActionSelectProvider),
			huh.NewOption("Configure BYO API providers", AuthActionBYOSetup),
			huh.NewOption("Exit authorization wizard", AuthActionExit),
		}
	}

	// Determine menu title based on status
	var title string
	renderer := display.NewRenderer(global.Config.OutputFormat)

	// Always show Cline authentication status
	if isClineAuthenticated {
		title = fmt.Sprintf("Cline Account: %s Authenticated\n", renderer.Green("✓"))
	} else {
		title = fmt.Sprintf("Cline Account: %s Not authenticated\n", renderer.Red("✗"))
	}

	// Show active provider and model if configured (regardless of Cline auth status)
	if currentProvider != "" && currentModel != "" {
		title += fmt.Sprintf("Active Provider: %s\nActive Model: %s\n",
			renderer.White(currentProvider),
			renderer.White(currentModel))
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
		// Check if user cancelled with Control-C
		if err == huh.ErrUserAborted {
			// Return the error to allow deferred cleanup to run
			return "", huh.ErrUserAborted
		}
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
		providerName := GetProviderDisplayName(provider)
		providerKey := fmt.Sprintf("provider_%d", provider)
		providerOptions = append(providerOptions, huh.NewOption(providerName, providerKey))
		providerMapping[providerKey] = provider
	}

	if len(providerOptions) == 0 {
		fmt.Println("No providers available. Please configure a provider first.")
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
		// Check if user cancelled with Control-C
		if err == huh.ErrUserAborted {
			return huh.ErrUserAborted
		}
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
// Uses the auth instance address from context if available, otherwise falls back to default
func createTaskManager(ctx context.Context) (*task.Manager, error) {
	authAddr := getAuthInstanceAddress(ctx)
	if authAddr != "" {
		return task.NewManagerForAddress(ctx, authAddr)
	}
	return task.NewManagerForDefault(ctx)
}

func verboseLog(format string, args ...interface{}) {
	if global.Config != nil && global.Config.Verbose {
		fmt.Printf("[VERBOSE] "+format+"\n", args...)
	}
}
