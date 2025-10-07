package main

import (
	"context"
	"fmt"
	"os"

	"github.com/cline/cli/pkg/cli"
	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/cli/pkg/common"
	"github.com/spf13/cobra"
)

var (
	coreAddress  string
	verbose      bool
	outputFormat string
)

func main() {
	rootCmd := &cobra.Command{
		Use:   "cline",
		Short: "Cline CLI - AI-powered coding assistant",
		Long: `A command-line interface for interacting with Cline AI coding assistant.

This CLI provides access to Cline's task management, configuration, and
monitoring capabilities from the terminal.`,
		PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
			if outputFormat != "rich" && outputFormat != "json" && outputFormat != "plain" {
				return fmt.Errorf("invalid output format '%s': must be one of 'rich', 'json', or 'plain'", outputFormat)
			}

			return global.InitializeGlobalConfig(&global.GlobalConfig{
				Verbose:      verbose,
				OutputFormat: outputFormat,
				CoreAddress:  coreAddress,
			})
		},
	}

	rootCmd.PersistentFlags().StringVar(&coreAddress, "address", fmt.Sprintf("localhost:%d", common.DEFAULT_CLINE_CORE_PORT), "Cline Core gRPC address")
	rootCmd.PersistentFlags().BoolVarP(&verbose, "verbose", "v", false, "verbose output")
	rootCmd.PersistentFlags().StringVarP(&outputFormat, "output-format", "o", "rich", "output format (rich|json|plain)")

	rootCmd.AddCommand(cli.NewTaskCommand())
	rootCmd.AddCommand(cli.NewInstanceCommand())
	rootCmd.AddCommand(cli.NewVersionCommand())
	rootCmd.AddCommand(cli.NewAuthCommand())
	rootCmd.AddCommand(cli.NewTaskSendCommand())

	if err := rootCmd.ExecuteContext(context.Background()); err != nil {
		os.Exit(1)
	}
}
