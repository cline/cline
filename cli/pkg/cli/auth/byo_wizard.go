package auth

import (
	"fmt"

	"github.com/charmbracelet/huh"
)

// ProviderWizard handles the interactive provider configuration process
type ProviderWizard struct{}

// NewProviderWizard creates a new provider configuration wizard
func NewProviderWizard() (*ProviderWizard, error) {
	return &ProviderWizard{}, nil
}

// Run runs the provider configuration wizard
func (pw *ProviderWizard) Run() error {
	fmt.Println("Welcome to Cline API Provider Configuration!")
	fmt.Println("(Currently stubbed - full implementation coming soon)")
	fmt.Println()

	for {
		action, err := pw.showMainMenu()
		if err != nil {
			return err
		}

		switch action {
		case "add":
			fmt.Println("Provider setup is currently stubbed - not yet implemented.")
		case "remove":
			fmt.Println("Provider removal is currently stubbed - not yet implemented.")
		case "list":
			fmt.Println("Provider listing is currently stubbed - not yet implemented.")
		case "test":
			fmt.Println("Provider testing is currently stubbed - not yet implemented.")
		case "default":
			fmt.Println("Setting default provider is currently stubbed - not yet implemented.")
		case "save":
			fmt.Println("No configuration to save.")
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
					huh.NewOption("Add a new provider", "add"),
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
