package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"slices"
	"strings"

	"github.com/charmbracelet/huh"
	"github.com/cline/cli/pkg/cli"
	"github.com/cline/cli/pkg/cli/auth"
	"github.com/cline/cli/pkg/cli/display"
	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/cli/pkg/cli/output"
	"github.com/cline/cli/pkg/cli/slash"
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
	mode       string
	settings   []string
	yolo       bool
	oneshot    bool
	workspaces []string
)

func main() {
	rootCmd := &cobra.Command{
		Use:     "cline [prompt]",
		Short:   "Cline CLI - AI-powered coding assistant",
		Version: global.CliVersion,
		Long: `A command-line interface for interacting with Cline AI coding assistant.

Start a new task by providing a prompt:
  cline "Create a new Python script that prints hello world"

Or pipe a prompt via stdin:
  echo "Create a todo app" | cline
  cat prompt.txt | cline --yolo

Or run with no arguments to enter interactive mode:
  cline

This CLI also provides task management, configuration, and monitoring capabilities.

For detailed documentation including all commands, options, and examples,
see the manual page: man cline`,
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

			// Validate workspace paths exist
			if err := common.ValidateDirsExist(workspaces); err != nil {
				return err
			}

			// Build the full workspace list: cwd first, then additional workspaces
			allWorkspaces, err := buildWorkspaceList(workspaces)
			if err != nil {
				return fmt.Errorf("failed to build workspace list: %w", err)
			}

			// If --address flag not provided, start instance BEFORE getting prompt
			if !cmd.Flags().Changed("address") {
				if global.Config.Verbose {
					fmt.Println("Starting new Cline instance...")
				}
				instance, err := global.Instances.StartNewInstance(ctx, allWorkspaces...)
				if err != nil {
					return fmt.Errorf("failed to start new instance: %w", err)
				}
				global.Config.CoreAddress = instance.CoreAddress
				if global.Config.Verbose {
					fmt.Printf("Started instance at %s\n\n", global.Config.CoreAddress)
				}

				// Set up cleanup on exit
				defer func() {
					if global.Config.Verbose {
						fmt.Println("\nCleaning up instance...")
					}
					registry := global.Instances.GetRegistry()
					if err := global.KillInstanceByAddress(context.Background(), registry, global.Config.CoreAddress); err != nil {
						if global.Config.Verbose {
							fmt.Printf("Warning: Failed to clean up instance: %v\n", err)
						}
					}
				}()
			}

			// Check if user has credentials configured
			if !isUserReadyToUse(ctx) {
				// Create renderer for welcome messages
				renderer := display.NewRenderer(global.Config.OutputFormat)
				fmt.Printf("\n%s\n\n", renderer.Dim("Hey there! Looks like you're new here. Let's get you set up"))

				if err := auth.HandleAuthMenuNoArgs(ctx); err != nil {
					// Check if user cancelled - exit cleanly
					if err == huh.ErrUserAborted {
						return nil
					}
					return fmt.Errorf("auth setup failed: %w", err)
				}

				// Re-check after auth wizard
				if !isUserReadyToUse(ctx) {
					return fmt.Errorf("credentials still not configured - please run 'cline auth' to complete setup")
				}

				fmt.Printf("\n%s\n\n", renderer.Dim("✓ Setup complete, you can now use the Cline CLI"))
			}

			// Get content from both args and stdin
			prompt, err := getContentFromStdinAndArgs(args)
			if err != nil {
				return fmt.Errorf("failed to read prompt: %w", err)
			}

			// If no prompt (or just a mode switch with no message), show interactive input
			// Loop to allow mode switches without a message
			bannerShown := false
			for prompt == "" {
				// Pass the mode flag and workspaces to banner so it shows correct info
				prompt, err = promptForInitialTask(ctx, mode, allWorkspaces, !bannerShown)
				bannerShown = true
				if err != nil {
					// Check if user cancelled - exit cleanly without error
					if err == huh.ErrUserAborted {
						return nil
					}
					return err
				}

				// Check if user entered a mode switch command
				if newMode, remaining, isModeSwitch := slash.ParseModeSwitch(prompt); isModeSwitch {
					mode = newMode
					prompt = remaining
					// If just a mode switch with no message, continue loop to re-prompt
					if prompt == "" {
						renderer := display.NewRenderer(global.Config.OutputFormat)
						if mode == "act" {
							fmt.Printf("\n%s\n\n", renderer.Success("Switched to act mode"))
						} else {
							fmt.Printf("\n%s\n\n", renderer.Success("Switched to plan mode"))
						}
						continue
					}
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
				Mode:       mode,
				Settings:   settings,
				Yolo:       yolo,
				Address:    global.Config.CoreAddress,
				Verbose:    verbose,
				Workspaces: allWorkspaces,
			})
		},
	}

	rootCmd.SetVersionTemplate(cli.VersionString())

	rootCmd.PersistentFlags().StringVar(&coreAddress, "address", fmt.Sprintf("localhost:%d", common.DEFAULT_CLINE_CORE_PORT), "Cline Core gRPC address")
	rootCmd.PersistentFlags().BoolVarP(&verbose, "verbose", "v", false, "verbose output")
	rootCmd.PersistentFlags().StringVarP(&outputFormat, "output-format", "F", "rich", "output format (rich|json|plain)")

	// Task creation flags (only apply when using root command with prompt)
	rootCmd.Flags().StringSliceVarP(&images, "image", "i", nil, "attach image files")
	rootCmd.Flags().StringSliceVarP(&files, "file", "f", nil, "attach files")
	rootCmd.Flags().StringVarP(&mode, "mode", "m", "plan", "mode (act|plan) - defaults to plan")
	rootCmd.Flags().StringSliceVarP(&settings, "setting", "s", nil, "task settings (key=value format)")
	rootCmd.Flags().BoolVarP(&yolo, "yolo", "y", false, "enable yolo mode (non-interactive)")
	rootCmd.Flags().BoolVar(&yolo, "no-interactive", false, "enable yolo mode (non-interactive)")
	rootCmd.Flags().BoolVarP(&oneshot, "oneshot", "o", false, "full autonomous mode")
	rootCmd.Flags().StringSliceVarP(&workspaces, "workspace", "w", nil, "additional workspace paths (can be specified multiple times)")

	rootCmd.AddCommand(cli.NewTaskCommand())
	rootCmd.AddCommand(cli.NewInstanceCommand())
	rootCmd.AddCommand(cli.NewConfigCommand())
	rootCmd.AddCommand(cli.NewVersionCommand())
	rootCmd.AddCommand(cli.NewAuthCommand())
	rootCmd.AddCommand(cli.NewLogsCommand())
	// rootCmd.AddCommand(cli.NewDoctorCommand()) // Disabled for now

	if err := rootCmd.ExecuteContext(context.Background()); err != nil {
		os.Exit(1)
	}
}

func promptForInitialTask(ctx context.Context, modeFlag string, workspaces []string, showBanner bool) (string, error) {
	// Show session banner before the initial input (only on first prompt)
	if showBanner {
		showSessionBanner(ctx, modeFlag, workspaces)
	}

	prompt, err := output.PromptForInitialTask(
		"Start a new Cline task",
		"/plan or /act to switch modes\ntab to autocomplete commands\nctrl+e to open editor\nctrl+c to exit",
		modeFlag,
		slash.NewRegistry(ctx),
	)
	if err != nil {
		if err == output.ErrUserAborted {
			return "", huh.ErrUserAborted
		}
		return "", err
	}

	return prompt, nil
}

// showSessionBanner displays session info before initial prompt
func showSessionBanner(ctx context.Context, modeFlag string, workspaces []string) {
	bannerInfo := display.BannerInfo{
		Version: global.CliVersion,
		Mode:    modeFlag, // Use the mode from command flag, not state
	}

	// If mode is empty, default to "plan"
	if bannerInfo.Mode == "" {
		bannerInfo.Mode = "plan"
	}

	bannerInfo.Workdirs = workspaces

	// Get provider/model using auth functions (same logic as auth menu)
	if providerList, err := auth.GetProviderConfigurations(ctx); err == nil {
		// Show provider/model for the mode we'll be using
		var providerDisplay *auth.ProviderDisplay
		if bannerInfo.Mode == "plan" && providerList.PlanProvider != nil {
			providerDisplay = providerList.PlanProvider
		} else if bannerInfo.Mode == "act" && providerList.ActProvider != nil {
			providerDisplay = providerList.ActProvider
		}

		if providerDisplay != nil {
			bannerInfo.Provider = auth.GetProviderIDForEnum(providerDisplay.Provider)
			bannerInfo.ModelID = providerDisplay.ModelID
		}
	}

	// Render and display banner
	banner := display.RenderSessionBanner(bannerInfo)
	fmt.Println(banner)
	fmt.Println() // Extra spacing before form
}

// isUserReadyToUse checks if the user has completed initial setup
// Returns true if welcomeViewCompleted flag is set OR user is authenticated
// Matches extension logic: welcomeViewCompleted = Boolean(globalState.welcomeViewCompleted || user?.uid)
func isUserReadyToUse(ctx context.Context) bool {
	grpcClient, err := global.GetClientForAddress(ctx, global.Config.CoreAddress)
	if err != nil {
		return false
	}

	state, err := grpcClient.State.GetLatestState(ctx, &cline.EmptyRequest{})
	if err != nil {
		return false
	}

	stateMap := make(map[string]interface{})
	if err := json.Unmarshal([]byte(state.StateJson), &stateMap); err != nil {
		return false
	}

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
		// Only try to read if there's actually data available
		if stat.Size() > 0 {
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
	}

	return content.String(), nil
}

// buildWorkspaceList builds the full workspace list with cwd as the first entry
func buildWorkspaceList(additionalWorkspaces []string) ([]string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return nil, fmt.Errorf("failed to get current working directory: %w", err)
	}

	// Start with cwd
	workspaces := []string{cwd}

	// Add additional workspaces, avoiding duplicates
	for _, ws := range additionalWorkspaces {
		// Normalize the path
		absPath, err := common.AbsPath(ws)
		if err != nil {
			return nil, fmt.Errorf("failed to resolve workspace path %s: %w", ws, err)
		}

		// Skip if it's the same as cwd
		if absPath == cwd {
			continue
		}

		// Check for duplicates
		isDuplicate := slices.Contains(workspaces, absPath)
		if !isDuplicate {
			workspaces = append(workspaces, absPath)
		}
	}

	return workspaces, nil
}
