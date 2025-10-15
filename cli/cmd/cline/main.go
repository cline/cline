package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/charmbracelet/huh"
	"github.com/cline/cli/pkg/cli"
	"github.com/cline/cli/pkg/cli/auth"
	"github.com/cline/cli/pkg/cli/display"
	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/cli/pkg/common"
	"github.com/cline/grpc-go/cline"
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
	oneshot    bool
)

func main() {
	rootCmd := &cobra.Command{
		Use:   "cline [prompt]",
		Short: "Cline CLI - AI-powered coding assistant",
		Long: `A command-line interface for interacting with Cline AI coding assistant.

Start a new task by providing a prompt:
  cline "Create a new Python script that prints hello world"

Or pipe a prompt via stdin:
  echo "Create a todo app" | cline
  cat prompt.txt | cline --yolo

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
				if global.Config.Verbose {
					fmt.Println("Starting new Cline instance...")
				}
				instance, err := global.Clients.StartNewInstance(ctx)
				if err != nil {
					return fmt.Errorf("failed to start new instance: %w", err)
				}
				instanceAddress = instance.Address
				if global.Config.Verbose {
					fmt.Printf("Started instance at %s\n\n", instanceAddress)
				}

				// Set up cleanup on exit
				defer func() {
					if global.Config.Verbose {
						fmt.Println("\nCleaning up instance...")
					}
					registry := global.Clients.GetRegistry()
					if err := global.KillInstanceByAddress(context.Background(), registry, instanceAddress); err != nil {
						if global.Config.Verbose {
							fmt.Printf("Warning: Failed to clean up instance: %v\n", err)
						}
					}
				}()

				// Check if user has credentials configured
				if !isUserReadyToUse(ctx, instanceAddress) {
					// Create renderer for welcome messages
					renderer := display.NewRenderer(global.Config.OutputFormat)

					markdown := "## hey there! looks like you're new here. let's get you set up"
					rendered := renderer.RenderMarkdown(markdown)
					fmt.Printf("\n%s\n\n", rendered)

					if err := auth.HandleAuthMenuNoArgs(ctx); err != nil {
						return fmt.Errorf("auth setup failed: %w", err)
					}

					// Re-check after auth wizard
					if !isUserReadyToUse(ctx, instanceAddress) {
						return fmt.Errorf("credentials still not configured - please run 'cline auth' to complete setup")
					}

					markdown = "## ✓ setup complete, you can now use the cline cli"
					rendered = renderer.RenderMarkdown(markdown)
					fmt.Printf("\n%s\n\n", rendered)
				}
			} else {
				// User specified --address flag, use that
				instanceAddress = coreAddress
			}

			// Get content from both args and stdin
			prompt, err := getContentFromStdinAndArgs(args)
			if err != nil {
				return fmt.Errorf("failed to read prompt: %w", err)
			}

			// If no prompt from args or stdin, show interactive input
			if prompt == "" {
				prompt, err = promptForInitialTask()
				if err != nil {
					return err
				}
				if prompt == "" {
					return fmt.Errorf("prompt required")
				}
			}

			// If oneshot mode, force plan mode and yolo
			if oneshot {
				mode = "plan"
				yolo = true
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
	rootCmd.PersistentFlags().StringVarP(&outputFormat, "output-format", "F", "rich", "output format (rich|json|plain)")

	// Task creation flags (only apply when using root command with prompt)
	rootCmd.Flags().StringSliceVarP(&images, "image", "i", nil, "attach image files")
	rootCmd.Flags().StringSliceVarP(&files, "file", "f", nil, "attach files")
	rootCmd.Flags().StringSliceVarP(&workspaces, "workdir", "w", nil, "workdir directory paths")
	rootCmd.Flags().StringVarP(&mode, "mode", "m", "plan", "mode (act|plan) - defaults to plan")
	rootCmd.Flags().StringSliceVarP(&settings, "setting", "s", nil, "task settings (key=value format)")
	rootCmd.Flags().BoolVarP(&yolo, "yolo", "y", false, "enable yolo mode (non-interactive)")
	rootCmd.Flags().BoolVar(&yolo, "no-interactive", false, "enable yolo mode (non-interactive)")
	rootCmd.Flags().BoolVarP(&oneshot, "oneshot", "o", false, "full autonomous mode")

	rootCmd.AddCommand(cli.NewTaskCommand())
	rootCmd.AddCommand(cli.NewInstanceCommand())
	rootCmd.AddCommand(cli.NewConfigCommand())
	rootCmd.AddCommand(cli.NewVersionCommand())
	rootCmd.AddCommand(cli.NewAuthCommand())
	rootCmd.AddCommand(cli.NewLogsCommand())

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

// isUserReadyToUse checks if the user has completed initial setup
// Returns true if welcomeViewCompleted flag is set OR user is authenticated
// Matches extension logic: welcomeViewCompleted = Boolean(globalState.welcomeViewCompleted || user?.uid)
func isUserReadyToUse(ctx context.Context, instanceAddress string) bool {
	manager, err := cli.NewTaskManagerForAddress(ctx, instanceAddress)
	if err != nil {
		return false
	}

	// Get state
	state, err := manager.GetClient().State.GetLatestState(ctx, &cline.EmptyRequest{})
	if err != nil {
		return false
	}

	// Parse state JSON
	stateMap := make(map[string]interface{})
	if err := json.Unmarshal([]byte(state.StateJson), &stateMap); err != nil {
		return false
	}

	// Check 1: welcomeViewCompleted flag
	if welcomeCompleted, ok := stateMap["welcomeViewCompleted"].(bool); ok && welcomeCompleted {
		return true
	}

	// Check 2: Is user authenticated? (matches extension's || user?.uid check)
	if userInfo, ok := stateMap["userInfo"].(map[string]interface{}); ok {
		if uid, ok := userInfo["uid"].(string); ok && uid != "" {
			return true
		}
	}

	return false
}

// getContentFromStdinAndArgs reads content from both command line args and stdin, and combines them
func getContentFromStdinAndArgs(args []string) (string, error) {
	var content strings.Builder

	// Add command line args first (if any)
	if len(args) > 0 {
		content.WriteString(strings.Join(args, " "))
	}

	// Check if stdin has data
	stat, err := os.Stdin.Stat()
	if err != nil {
		return "", fmt.Errorf("failed to stat stdin: %w", err)
	}

	// Check if data is being piped to stdin
	if (stat.Mode() & os.ModeCharDevice) == 0 {
		stdinBytes, err := io.ReadAll(os.Stdin)
		if err != nil {
			return "", fmt.Errorf("failed to read from stdin: %w", err)
		}

		stdinContent := strings.TrimSpace(string(stdinBytes))
		if stdinContent != "" {
			if content.Len() > 0 {
				content.WriteString(" ")
			}
			content.WriteString(stdinContent)
		}
	}

	return content.String(), nil
}