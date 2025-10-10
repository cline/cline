package auth

import (
	"context"
	"fmt"

	"github.com/charmbracelet/huh"
)

// AuthAction represents the type of authentication action
type AuthAction string

const (
	AuthActionClineLogin    AuthAction = "cline_login"
	AuthActionBYOSetup AuthAction = "provider_setup"
)

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
		return fmt.Errorf("too many arguments. Usage: cline auth [provider] [key]")
	}
}

// HandleAuthMenuNoArgs offers Cline auth or provider setup when no args are given
func HandleAuthMenuNoArgs(ctx context.Context) error {
	action, err := ShowAuthMenuNoArgs()
	if err != nil {
		return err
	}

	switch action {
	case AuthActionClineLogin:
		return HandleClineAuth(ctx)
	case AuthActionBYOSetup:
		return HandleAPIProviderSetup()
	default:
		return fmt.Errorf("invalid action")
	}
}

// ShowAuthMenu displays the main auth menu and returns the selected action
func ShowAuthMenuNoArgs() (AuthAction, error) {
	var action AuthAction
	form := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[AuthAction]().
				Title("What would you like to do?").
				Options(
					huh.NewOption("Authenticate with Cline account", AuthActionClineLogin),
					huh.NewOption("Configure API provider", AuthActionBYOSetup),
				).
				Value(&action),
		),
	)

	if err := form.Run(); err != nil {
		return "", fmt.Errorf("failed to get menu choice: %w", err)
	}

	return action, nil
}

// HandleProviderSetup launches the API provider configuration wizard
func HandleAPIProviderSetup() error {
	wizard, err := NewProviderWizard()
	if err != nil {
		return fmt.Errorf("failed to create provider wizard: %w", err)
	}

	return wizard.Run()
}
