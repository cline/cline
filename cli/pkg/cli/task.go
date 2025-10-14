package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"slices"
	"strconv"
	"strings"

	"github.com/cline/cli/pkg/cli/config"
	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/cli/pkg/cli/task"
	"github.com/spf13/cobra"
)

// TaskOptions contains options for creating a task
type TaskOptions struct {
	Images     []string
	Files      []string
	Workspaces []string
	Mode       string
	Settings   []string
	Yolo       bool
	Address    string
}

func NewTaskCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "task",
		Aliases: []string{"t"},
		Short:   "Manage Cline tasks",
		Long:    `Create, monitor, and manage Cline AI tasks.`,
	}

	cmd.AddCommand(newTaskNewCommand())
	cmd.AddCommand(newTaskOneshotCommand())
	cmd.AddCommand(newTaskPauseCommand())
	cmd.AddCommand(newTaskChatCommand())
	cmd.AddCommand(newTaskSendCommand())
	cmd.AddCommand(newTaskViewCommand())
	cmd.AddCommand(newTaskListCommand())
	cmd.AddCommand(newTaskOpenCommand())
	cmd.AddCommand(newTaskRestoreCommand())

	return cmd
}

var taskManager *task.Manager

func ensureTaskManager(ctx context.Context, address string) error {
	if taskManager == nil || (address != "" && taskManager.GetCurrentInstance() != address) {
		var err error
		var instanceAddress string

		if address != "" {
			// Ensure instance exists at the specified address
			if err := ensureInstanceAtAddress(ctx, address); err != nil {
				return fmt.Errorf("failed to ensure instance at address %s: %w", address, err)
			}
			taskManager, err = task.NewManagerForAddress(ctx, address)
			instanceAddress = address
		} else {
			// Ensure default instance exists
			if err := global.EnsureDefaultInstance(ctx); err != nil {
				return fmt.Errorf("failed to ensure default instance: %w", err)
			}
			taskManager, err = task.NewManagerForDefault(ctx)
			if err == nil {
				instanceAddress = taskManager.GetCurrentInstance()
			}
		}

		if err != nil {
			return fmt.Errorf("failed to create task manager: %w", err)
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

// ensureInstanceAtAddress ensures an instance exists at the given address
func ensureInstanceAtAddress(ctx context.Context, address string) error {
	if global.Clients == nil {
		return fmt.Errorf("global clients not initialized")
	}
	return global.Clients.EnsureInstanceAtAddress(ctx, address)
}

func newTaskNewCommand() *cobra.Command {
	var (
		images     []string
		files      []string
		workspaces []string
		address    string
		mode       string
		settings   []string
		yolo       bool
	)

	cmd := &cobra.Command{
		Use:     "new <prompt>",
		Aliases: []string{"n"},
		Short:   "Create a new task",
		Long:    `Create a new Cline task with the specified prompt. If no Cline instance exists at the specified address, a new one will be started automatically.`,
		Args:    cobra.MinimumNArgs(0),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()

			// Get content from both args and stdin
			prompt, err := getContentFromStdinAndArgs(args)
			if err != nil {
				return fmt.Errorf("failed to read prompt: %w", err)
			}

			// Validate that prompt is passed in call
			if prompt == "" {
				return fmt.Errorf("prompt required: provide as argument or pipe via stdin")
			}

			// Ensure task manager is initialized
			if err := ensureTaskManager(ctx, address); err != nil {
				return err
			}

			// Set mode if provided
			if mode != "" {
				if err := taskManager.SetMode(ctx, mode, nil, nil, nil); err != nil {
					return fmt.Errorf("failed to set mode: %w", err)
				}
				if global.Config.Verbose {
					fmt.Printf("Mode set to: %s\n", mode)
				}
			}

			// Inject yolo_mode_toggled setting if --yolo flag is set

			// Will append to the -s settings to be parsed by the settings parser logic.
			// If the yoloMode is also set in the settings, this will override that, since it will be set last.
			if yolo {
				settings = append(settings, "yolo_mode_toggled=true")
			}

			// Create the task
			taskID, err := taskManager.CreateTask(ctx, prompt, images, files, workspaces, settings)
			if err != nil {
				return fmt.Errorf("failed to create task: %w", err)
			}

			if global.Config.Verbose {
				fmt.Printf("Task created successfully with ID: %s\n", taskID)
			}

			return nil
		},
	}

	cmd.Flags().StringSliceVarP(&images, "image", "i", nil, "attach image files")
	cmd.Flags().StringSliceVarP(&files, "file", "f", nil, "attach files")
	cmd.Flags().StringSliceVarP(&workspaces, "workdir", "w", nil, "workdir directory paths")
	cmd.Flags().StringVar(&address, "address", "", "specific Cline instance address to use")
	cmd.Flags().StringVarP(&mode, "mode", "m", "", "mode (act|plan)")
	cmd.Flags().StringSliceVarP(&settings, "setting", "s", nil, "task settings (key=value format, e.g., -s aws-region=us-west-2 -s mode=act)")
	cmd.Flags().BoolVarP(&yolo, "yolo", "y", false, "enable yolo mode (non-interactive)")

	return cmd
}

func newTaskOneshotCommand() *cobra.Command {
	var (
		images     []string
		files      []string
		workspaces []string
		address    string
		settings   []string
	)

	cmd := &cobra.Command{
		Use:     "oneshot <prompt>",
		Aliases: []string{"o"},
		Short:   "Create a task in yolo+plan mode and view until completion",
		Long:    `Creates a new task in yolo mode (non-interactive) and plan mode, then streams the conversation until completion.`,
		Args:    cobra.MinimumNArgs(0),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()

			// Get prompt from args/stdin
			prompt, err := getContentFromStdinAndArgs(args)
			if err != nil {
				return fmt.Errorf("failed to read prompt: %w", err)
			}

			if prompt == "" {
				return fmt.Errorf("prompt required: provide as argument or pipe via stdin")
			}

			// Ensure task manager
			if err := ensureTaskManager(ctx, address); err != nil {
				return err
			}

			// Set mode to plan
			if err := taskManager.SetMode(ctx, "plan", nil, nil, nil); err != nil {
				return fmt.Errorf("failed to set plan mode: %w", err)
			}

			if global.Config.Verbose {
				fmt.Println("Mode set to: plan")
			}

			// Inject yolo mode into settings
			settings = append(settings, "yolo_mode_toggled=true")

			// Create task
			taskID, err := taskManager.CreateTask(ctx, prompt, images, files, workspaces, settings)
			if err != nil {
				return fmt.Errorf("failed to create task: %w", err)
			}

			fmt.Printf("Task created in yolo+plan mode (ID: %s)\n", taskID)
			fmt.Printf("Using instance: %s\n", taskManager.GetCurrentInstance())

			// Follow until completion
			return taskManager.FollowConversationUntilCompletion(ctx)
		},
	}

	cmd.Flags().StringSliceVarP(&images, "image", "i", nil, "attach image files")
	cmd.Flags().StringSliceVarP(&files, "file", "f", nil, "attach files")
	cmd.Flags().StringSliceVarP(&workspaces, "workdir", "w", nil, "workdir directory paths")
	cmd.Flags().StringVar(&address, "address", "", "specific Cline instance address to use")
	cmd.Flags().StringSliceVarP(&settings, "setting", "s", nil, "task settings (key=value format, e.g., -s model=claude)")

	return cmd
}

func newTaskPauseCommand() *cobra.Command {
	var address string

	cmd := &cobra.Command{
		Use:     "pause",
		Aliases: []string{"p"},
		Short:   "Pause the current task",
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()

			if err := ensureTaskManager(ctx, address); err != nil {
				return err
			}

			if err := taskManager.CancelTask(ctx); err != nil {
				return err
			}

			fmt.Println("Task paused successfully")
			fmt.Printf("Instance: %s\n", taskManager.GetCurrentInstance())
			return nil
		},
	}

	cmd.Flags().StringVar(&address, "address", "", "specific Cline instance address to use")
	return cmd
}

func newTaskSendCommand() *cobra.Command {
	var (
		images  []string
		files   []string
		address string
		mode    string
		approve bool
		deny    bool
		yolo    bool
	)

	cmd := &cobra.Command{
		Use:     "send [message]",
		Aliases: []string{"s"},
		Short:   "Send a followup message to the current task and/or update mode/approve",
		Long:    `Send a followup message to continue the conversation with the current task and/or update mode/approve.`,
		Args:    cobra.MinimumNArgs(0),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()

			// Check if an instance exists when no address specified
			if address == "" && global.Clients.GetRegistry().GetDefaultInstance() == "" {
				fmt.Println("No instances available for sending messages")
				return nil
			}

			// Get content from both args and stdin
			message, err := getContentFromStdinAndArgs(args)
			if err != nil {
				return fmt.Errorf("failed to read message: %w", err)
			}

			if message == "" && len(images) == 0 && len(files) == 0 && mode == "" && !approve && !deny {
				return fmt.Errorf("content (message, files, images) required unless using --mode, --approve, or --deny flags")
			}

			if approve && deny {
				return fmt.Errorf("cannot use both --approve and --deny flags")
			}

			if (approve || deny) && mode != "" {
				return fmt.Errorf("cannot use --approve/--deny and --mode together")
			}

			// Ensure task manager is initialized
			if err := ensureTaskManager(ctx, address); err != nil {
				return err
			}

			// Check if we can send a message
			err = taskManager.CheckSendEnabled(ctx)
			if err != nil {
				// Handle specific error cases
				if errors.Is(err, task.ErrNoActiveTask) {
					fmt.Println("Cannot send message: no active task")
					return nil
				}
				if errors.Is(err, task.ErrTaskBusy) {
					fmt.Println("Cannot send message: task is currently busy")
					return nil
				}
				// All other errors are unexpected
				return fmt.Errorf("failed to check if message can be sent: %w", err)
			}

			// Process yolo flag and apply settings
			if yolo {
				settings := []string{"yolo_mode_toggled=true"}
				parsedSettings, secrets, err := task.ParseTaskSettings(settings)
				if err != nil {
					return fmt.Errorf("failed to parse settings: %w", err)
				}

				configManager, err := config.NewManager(ctx, taskManager.GetCurrentInstance())
				if err != nil {
					return fmt.Errorf("failed to create config manager: %w", err)
				}

				if err := configManager.UpdateSettings(ctx, parsedSettings, secrets); err != nil {
					return fmt.Errorf("failed to apply settings: %w", err)
				}
			}

			if mode != "" {
				if err := taskManager.SetModeAndSendMessage(ctx, mode, message, images, files); err != nil {
					return fmt.Errorf("failed to set mode and send message: %w", err)
				}
				fmt.Printf("Mode set to %s and message sent successfully.\n", mode)

			} else {
				// Convert approve/deny booleans to string
				approveStr := ""
				if approve {
					approveStr = "true"
				}
				if deny {
					approveStr = "false"
				}

				if err := taskManager.SendMessage(ctx, message, images, files, approveStr); err != nil {
					return err
				}
				fmt.Printf("Message sent successfully.\n")
			}

			fmt.Printf("Instance: %s\n", taskManager.GetCurrentInstance())
			return nil
		},
	}

	cmd.Flags().StringSliceVarP(&images, "image", "i", nil, "attach image files")
	cmd.Flags().StringSliceVarP(&files, "file", "f", nil, "attach files")
	cmd.Flags().StringVar(&address, "address", "", "specific Cline instance address to use")
	cmd.Flags().StringVarP(&mode, "mode", "m", "", "mode (act|plan)")
	cmd.Flags().BoolVarP(&approve, "approve", "a", false, "approve pending request")
	cmd.Flags().BoolVarP(&deny, "deny", "d", false, "deny pending request")
	cmd.Flags().BoolVarP(&yolo, "yolo", "y", false, "enable yolo mode (non-interactive)")
	cmd.Flags().BoolVar(&yolo, "no-interactive", false, "enable yolo mode (non-interactive)")

	return cmd
}

func newTaskChatCommand() *cobra.Command {
	var address string

	cmd := &cobra.Command{
		Use:     "chat",
		Aliases: []string{"c"},
		Short:   "Chat with the current task in interactive mode",
		Long:    `Chat with the current task, displaying messages in real-time with interactive input enabled.`,
		Args:    cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()

			if err := ensureTaskManager(ctx, address); err != nil {
				return err
			}

			return taskManager.FollowConversation(ctx, taskManager.GetCurrentInstance(), true)
		},
	}

	cmd.Flags().StringVar(&address, "address", "", "specific Cline instance address to use")

	return cmd
}

func newTaskViewCommand() *cobra.Command {
	var (
		current bool
		summary bool
		address string
	)

	cmd := &cobra.Command{
		Use:     "view",
		Aliases: []string{"v"},
		Short:   "View task conversation",
		Long:    `Output conversation until next completion, with options for current state or summary only.`,
		Args:    cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()

			if err := ensureTaskManager(ctx, address); err != nil {
				return err
			}

			fmt.Printf("Using instance: %s\n", taskManager.GetCurrentInstance())

			if current {
				return taskManager.ShowConversation(ctx)
			} else if summary {
				return taskManager.GatherFinalSummary(ctx)
			} else {
				return taskManager.FollowConversationUntilCompletion(ctx)
			}
		},
	}

	cmd.Flags().BoolVarP(&current, "current", "c", false, "output current conversation without following")
	cmd.Flags().BoolVarP(&summary, "summary", "s", false, "outputs only the completion summary")
	cmd.Flags().StringVar(&address, "address", "", "specific Cline instance address to use")

	return cmd
}

func newTaskListCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "list",
		Aliases: []string{"l"},
		Short:   "List recent task history",
		Long:    `Display recent tasks from task history.`,
		Args:    cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			// Read directly from disk
			return task.ListTasksFromDisk()
		},
	}

	return cmd
}

func newTaskOpenCommand() *cobra.Command {
	var (
		address  string
		mode     string
		settings []string
		yolo     bool
	)

	cmd := &cobra.Command{
		Use:     "open <task-id>",
		Aliases: []string{"o"},
		Short:   "Open a task by ID",
		Long:    `Open an existing task by ID and optionally update settings or mode.`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()
			taskID := args[0]

			// Ensure task manager is initialized
			if err := ensureTaskManager(ctx, address); err != nil {
				return err
			}

			fmt.Printf("Using instance: %s\n", taskManager.GetCurrentInstance())

			// Resume the task
			if err := taskManager.ResumeTask(ctx, taskID); err != nil {
				return err
			}

			// Apply mode if provided
			if mode != "" {
				if err := taskManager.SetMode(ctx, mode, nil, nil, nil); err != nil {
					return fmt.Errorf("failed to set mode: %w", err)
				}
				if global.Config.Verbose {
					fmt.Printf("Mode set to: %s\n", mode)
				}
			}

			// Process yolo flag and apply settings
			if yolo {
				settings = append(settings, "yolo_mode_toggled=true")
			}

			if len(settings) > 0 {
				// Parse settings using existing parser
				parsedSettings, secrets, err := task.ParseTaskSettings(settings)
				if err != nil {
					return fmt.Errorf("failed to parse settings: %w", err)
				}

				// Create config manager to apply settings
				configManager, err := config.NewManager(ctx, taskManager.GetCurrentInstance())
				if err != nil {
					return fmt.Errorf("failed to create config manager: %w", err)
				}

				// Apply the settings to the instance
				if err := configManager.UpdateSettings(ctx, parsedSettings, secrets); err != nil {
					return fmt.Errorf("failed to apply settings: %w", err)
				}
			}

			return nil
		},
	}

	cmd.Flags().StringVar(&address, "address", "", "specific Cline instance address to use")
	cmd.Flags().StringVarP(&mode, "mode", "m", "", "mode (act|plan)")
	cmd.Flags().StringSliceVarP(&settings, "setting", "s", nil, "task settings (key=value format, e.g., -s model=claude)")
	cmd.Flags().BoolVarP(&yolo, "yolo", "y", false, "enable yolo mode (non-interactive)")
	cmd.Flags().BoolVar(&yolo, "no-interactive", false, "enable yolo mode (non-interactive)")

	return cmd
}

func newTaskRestoreCommand() *cobra.Command {
	var (
		restoreType string
		address     string
	)

	cmd := &cobra.Command{
		Use:   "restore <checkpoint-id>",
		Short: "Restore task to a specific checkpoint",
		Long:  `Restore the current task to a specific checkpoint by checkpoint ID (timestamp) and by type.`,
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()
			checkpointID := args[0]

			// Convert checkpoint ID string to int64
			id, err := strconv.ParseInt(checkpointID, 10, 64)
			if err != nil {
				return fmt.Errorf("invalid checkpoint ID '%s': must be a valid number", checkpointID)
			}

			validTypes := []string{"task", "workspace", "taskAndWorkspace"}
			if !slices.Contains(validTypes, restoreType) {
				return fmt.Errorf("invalid restore type '%s': must be one of [task, workspace, taskAndWorkspace]", restoreType)
			}

			// Ensure task manager is initialized
			if err := ensureTaskManager(ctx, address); err != nil {
				return err
			}

			// Validate checkpoint exists before attempting restore
			if err := taskManager.ValidateCheckpointExists(ctx, id); err != nil {
				return err
			}

			fmt.Printf("Using instance: %s\n", taskManager.GetCurrentInstance())
			fmt.Printf("Restoring to checkpoint %d (type: %s)\n", id, restoreType)

			if err := taskManager.RestoreCheckpoint(ctx, id, restoreType); err != nil {
				return fmt.Errorf("failed to restore checkpoint: %w", err)
			}

			fmt.Println("Checkpoint restored successfully")
			return nil
		},
	}

	cmd.Flags().StringVarP(&restoreType, "type", "t", "task", "Restore type (task, workspace, taskAndWorkspace)")
	cmd.Flags().StringVar(&address, "address", "", "specific Cline instance address to use")

	return cmd
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

// CleanupTaskManager cleans up the task manager resources
func CleanupTaskManager() {
	if taskManager != nil {
		taskManager.Cleanup()
	}
}

// NewTaskManagerForAddress is an exported wrapper around task.NewManagerForAddress
func NewTaskManagerForAddress(ctx context.Context, address string) (*task.Manager, error) {
	return task.NewManagerForAddress(ctx, address)
}

// CreateAndFollowTask creates a new task and immediately follows it in interactive mode
// This is used by the root command to provide a streamlined UX
func CreateAndFollowTask(ctx context.Context, prompt string, opts TaskOptions) error {
	// Initialize task manager with the provided instance address
	if err := ensureTaskManager(ctx, opts.Address); err != nil {
		return err
	}

	// Set mode to plan by default if not specified
	if opts.Mode == "" {
		opts.Mode = "plan"
	}

	// Set mode if provided
	if opts.Mode != "" {
		if err := taskManager.SetMode(ctx, opts.Mode, nil, nil, nil); err != nil {
			return fmt.Errorf("failed to set mode: %w", err)
		}
		if global.Config.Verbose {
			fmt.Printf("Mode set to: %s\n", opts.Mode)
		}
	}

	// Inject yolo_mode_toggled setting if --yolo flag is set
	if opts.Yolo {
		opts.Settings = append(opts.Settings, "yolo_mode_toggled=true")
	}

	// Create the task
	taskID, err := taskManager.CreateTask(ctx, prompt, opts.Images, opts.Files, opts.Workspaces, opts.Settings)
	if err != nil {
		return fmt.Errorf("failed to create task: %w", err)
	}

	if global.Config.Verbose {
		fmt.Printf("Task created successfully with ID: %s\n\n", taskID)
	}

	// Immediately follow the conversation in interactive mode
	return taskManager.FollowConversation(ctx, taskManager.GetCurrentInstance(), true)
}
