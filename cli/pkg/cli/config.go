package cli

import (
	"fmt"

	"github.com/spf13/cobra"
)

func NewConfigCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "config",
		Aliases: []string{"c"},
		Short:   "View and manage Cline configurations",
		Long:    `View and manage Cline configurations`,
	}

	cmd.AddCommand(newConfigListCommand())
	cmd.AddCommand(newConfigGetCommand())

	return cmd
}

func newConfigGetCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "get <key>",
		Aliases: []string{"g"},
		Short:   "Get a specific configuration value",
		Long:    `Get the value of a specific configuration setting.`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			key := args[0]
			return nil
		},
	}

	return cmd
}

func newConfigListCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "list",
		Aliases: []string{"l"},
		Short:   "List all configuration settings",
		Long:    `List all configuration settings from the Cline instance.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			return nil
		},
	}

	return cmd
}
