package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/charmbracelet/huh"
	"github.com/cline/cli/pkg/cli"
	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/cli/pkg/common"
	"github.com/spf13/cobra"
)

var (
	coreAddress  string
	verbose      bool
	outputFormat string

	// Task creation flags (for root command)
	images     []string
	files      []string
	workspaces []string
	mode       string
	settings   []string
	yolo       bool
)

func main() {
	rootCmd := &cobra.Command{
		Use:   "cline [prompt]",
		Short: "Cline CLI - AI-powered coding assistant",
		Long: `A command-line interface for interacting with Cline AI coding assistant.

Start a new task by providing a prompt:
  cline "Create a new Python script that prints hello world"

Or run with no arguments to enter interactive mode:
  cline

This CLI also provides task management, configuration, and monitoring capabilities.`,
		Args: cobra.ArbitraryArgs,
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
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()

			var instanceAddress string

			// If --address flag not provided, start instance BEFORE getting prompt
			if !cmd.Flags().Changed("address") {
				fmt.Println("Starting new Cline instance...")
				instance, err := global.Clients.StartNewInstance(ctx)
				if err != nil {
					return fmt.Errorf("failed to start new instance: %w", err)
				}
				instanceAddress = instance.Address
				fmt.Printf("Started instance at %s\n\n", instanceAddress)

				// Set up cleanup on exit
				defer func() {
					fmt.Println("\nCleaning up instance...")
					registry := global.Clients.GetRegistry()
					if err := global.KillInstanceByAddress(context.Background(), registry, instanceAddress); err != nil {
						fmt.Printf("Warning: Failed to clean up instance: %v\n", err)
					}
				}()
			} else {
				// User specified --address flag, use that
				instanceAddress = coreAddress
			}

			var prompt string

			// If args provided, use as prompt
			if len(args) > 0 {
				prompt = strings.Join(args, " ")
			} else {
				// Show interactive input to get prompt
				var err error
				prompt, err = promptForInitialTask()
				if err != nil {
					return err
				}
				if prompt == "" {
					return fmt.Errorf("prompt required")
				}
			}

			return cli.CreateAndFollowTask(ctx, prompt, cli.TaskOptions{
				Images:     images,
				Files:      files,
				Workspaces: workspaces,
				Mode:       mode,
				Settings:   settings,
				Yolo:       yolo,
				Address:    instanceAddress,
			})
		},
	}

	rootCmd.PersistentFlags().StringVar(&coreAddress, "address", fmt.Sprintf("localhost:%d", common.DEFAULT_CLINE_CORE_PORT), "Cline Core gRPC address")
	rootCmd.PersistentFlags().BoolVarP(&verbose, "verbose", "v", false, "verbose output")
	rootCmd.PersistentFlags().StringVarP(&outputFormat, "output-format", "o", "rich", "output format (rich|json|plain)")

	// Task creation flags (only apply when using root command with prompt)
	rootCmd.Flags().StringSliceVarP(&images, "image", "i", nil, "attach image files")
	rootCmd.Flags().StringSliceVarP(&files, "file", "f", nil, "attach files")
	rootCmd.Flags().StringSliceVarP(&workspaces, "workdir", "w", nil, "workdir directory paths")
	rootCmd.Flags().StringVarP(&mode, "mode", "m", "plan", "mode (act|plan) - defaults to plan")
	rootCmd.Flags().StringSliceVarP(&settings, "setting", "s", nil, "task settings (key=value format)")
	rootCmd.Flags().BoolVarP(&yolo, "yolo", "y", false, "enable yolo mode (non-interactive)")

	rootCmd.AddCommand(cli.NewTaskCommand())
	rootCmd.AddCommand(cli.NewInstanceCommand())
	rootCmd.AddCommand(cli.NewConfigCommand())
	rootCmd.AddCommand(cli.NewVersionCommand())
	rootCmd.AddCommand(cli.NewAuthCommand())
	rootCmd.AddCommand(cli.NewTaskSendCommand())

	if err := rootCmd.ExecuteContext(context.Background()); err != nil {
		os.Exit(1)
	}
}

func promptForInitialTask() (string, error) {
	var prompt string

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewText().
				Title("Start a new Cline task").
				Description("What would you like Cline to help you with?").
				Placeholder("e.g., Create a REST API with authentication...").
				Lines(5).
				Value(&prompt),
		),
	)

	err := form.Run()
	if err != nil {
		return "", err
	}

	return strings.TrimSpace(prompt), nil
}
