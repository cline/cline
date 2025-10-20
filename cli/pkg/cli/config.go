package cli

import (
	"context"
	"fmt"

	"github.com/cline/cli/pkg/cli/config"
	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/cli/pkg/cli/task"
	"github.com/spf13/cobra"
)

var configManager *config.Manager

func ensureConfigManager(ctx context.Context, address string) error {
	if configManager == nil || (address != "" && configManager.GetCurrentInstance() != address) {
		var err error
		var instanceAddress string

		if address != "" {
			// Ensure instance exists at the specified address
			if err := ensureInstanceAtAddress(ctx, address); err != nil {
				return fmt.Errorf("failed to ensure instance at address %s: %w", address, err)
			}
			configManager, err = config.NewManager(ctx, address)
			instanceAddress = address
		} else {
			// Ensure default instance exists
			if err := global.EnsureDefaultInstance(ctx); err != nil {
				return fmt.Errorf("failed to ensure default instance: %w", err)
			}
			configManager, err = config.NewManager(ctx, "")
			if err == nil {
				instanceAddress = configManager.GetCurrentInstance()
			}
		}

		if err != nil {
			return fmt.Errorf("failed to create config manager: %w", err)
		}

		// Always set the instance we're using as the default
		registry := global.Clients.GetRegistry()
		if err := registry.SetDefaultInstance(instanceAddress); err != nil {
			// Log warning but don't fail - this is not critical
			fmt.Printf("Warning: failed to set default instance: %v\n", err)
		}
	}
	return nil
}

func NewConfigCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "config",
		Aliases: []string{"c"},
		Short:   "Manage Cline configuration",
		Long:    `Set and manage global Cline configuration variables.`,
	}

	cmd.AddCommand(newConfigListCommand())
	cmd.AddCommand(newConfigGetCommand())
	cmd.AddCommand(setCommand())

	return cmd
}

func newConfigGetCommand() *cobra.Command {
	var address string

	cmd := &cobra.Command{
		Use:     "get <key>",
		Aliases: []string{"g"},
		Short:   "Get a specific configuration value",
		Long:    `Get the value of a specific configuration setting. Supports nested keys using dot notation (e.g., auto-approval-settings.actions.read-files).`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()
			key := args[0]

			// Ensure config manager
			if err := ensureConfigManager(ctx, address); err != nil {
				return err
			}

			// Get the setting
			return configManager.GetSetting(ctx, key)
		},
	}

	cmd.Flags().StringVar(&address, "address", "", "specific Cline instance address to use")
	return cmd
}

func newConfigListCommand() *cobra.Command {
	var address string

	cmd := &cobra.Command{
		Use:     "list",
		Aliases: []string{"l"},
		Short:   "List all configuration settings",
		Long:    `List all configuration settings from the Cline instance.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()

			// Ensure config manager
			if err := ensureConfigManager(ctx, address); err != nil {
				return err
			}

			// List settings
			return configManager.ListSettings(ctx)
		},
	}

	cmd.Flags().StringVar(&address, "address", "", "specific Cline instance address to use")
	return cmd
}

func setCommand() *cobra.Command {
	var address string

	cmd := &cobra.Command{
		Use:     "set <key=value> [key=value...]",
		Aliases: []string{"s"},
		Short:   "Set configuration variables",
		Long:    `Set one or more global configuration variables using key=value format.
		
This command merges the provided settings with existing values, preserving
unspecified fields. Only the fields you explicitly set will be updated.`,
		Args:    cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()

			// Parse using existing task parser
			settings, secrets, err := task.ParseTaskSettings(args)
			if err != nil {
				return fmt.Errorf("failed to parse settings: %w", err)
			}

			// Ensure config manager
			if err := ensureConfigManager(ctx, address); err != nil {
				return err
			}

			// Update settings (server-side merge handles preserving existing values)
			return configManager.UpdateSettings(ctx, settings, secrets)
		},
	}

	cmd.Flags().StringVar(&address, "address", "", "specific Cline instance address to use")
	return cmd
}
