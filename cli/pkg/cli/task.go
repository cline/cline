package cli

import (
	"context"
	"fmt"
	"io"
	"os"
	"slices"
	"strconv"
	"strings"

	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/cli/pkg/cli/task"
	"github.com/spf13/cobra"
)

func NewTaskCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "task",
		Aliases: []string{"t"},
		Short:   "Manage Cline tasks",
		Long:    `Create, monitor, and manage Cline AI tasks.`,
	}

	cmd.AddCommand(newTaskNewCommand())
	cmd.AddCommand(newTaskOneshotCommand())
	cmd.AddCommand(newTaskCancelCommand())
	cmd.AddCommand(newTaskFollowCommand())
	cmd.AddCommand(NewTaskSendCommand())
	cmd.AddCommand(newTaskViewCommand())
	cmd.AddCommand(newTaskListCommand())
	cmd.AddCommand(newTaskResumeCommand())
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
		wait       bool
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
				fmt.Printf("Mode set to: %s\n", mode)
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

			fmt.Printf("Task created successfully with ID: %s\n", taskID)

			// Wait for completion if requested
			if wait {
				return taskManager.FollowConversation(ctx, taskManager.GetCurrentInstance())
			}

			return nil
		},
	}

	cmd.Flags().StringSliceVarP(&images, "image", "i", nil, "attach image files")
	cmd.Flags().StringSliceVarP(&files, "file", "f", nil, "attach files")
	cmd.Flags().BoolVar(&wait, "wait", false, "wait for task completion")
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
			fmt.Println("Mode set to: plan")

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

func newTaskCancelCommand() *cobra.Command {
	var address string

	cmd := &cobra.Command{
		Use:     "cancel",
		Aliases: []string{"c"},
		Short:   "Cancel the current task",
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()

			if err := ensureTaskManager(ctx, address); err != nil {
				return err
			}

			if err := taskManager.CancelTask(ctx); err != nil {
				return err
			}

			fmt.Println("Task cancelled successfully")
			fmt.Printf("Instance: %s\n", taskManager.GetCurrentInstance())
			return nil
		},
	}

	cmd.Flags().StringVar(&address, "address", "", "specific Cline instance address to use")
	return cmd
}

func NewTaskSendCommand() *cobra.Command {
	var (
		images  []string
		files   []string
		address string
		mode    string
		approve string
	)

	cmd := &cobra.Command{
		Use:     "send [message]",
		Aliases: []string{"s"},
		Short:   "Send a followup message to the current task and/or update mode/approve",
		Long:    `Send a followup message to continue the conversation with the current task and/or update mode/approve.`,
		Args:    cobra.MinimumNArgs(0),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()

			// Get content from both args and stdin
			message, err := getContentFromStdinAndArgs(args)
			if err != nil {
				return fmt.Errorf("failed to read message: %w", err)
			}

			if message == "" && len(images) == 0 && len(files) == 0 && mode == "" && approve == "" {
				return fmt.Errorf("content (message, files, images) required unless using --mode or --approve flags")
			}

			if approve != "" && approve != "true" && approve != "false" {
				return fmt.Errorf("--approve must be 'true' or 'false'")
			}

			if approve != "" && mode != "" {
				return fmt.Errorf("cannot use --approve and --mode together")
			}

			// Ensure task manager is initialized
			if err := ensureTaskManager(ctx, address); err != nil {
				return err
			}

			sendDisabled, err := taskManager.CheckSendDisabled(ctx)

			if err != nil {
				return fmt.Errorf("failed to check if message can be sent: %w", err)
			}

			if sendDisabled {
				fmt.Println("Cannot send message: task is currently busy")
				return nil
			}

			if mode != "" {
				if err := taskManager.SetModeAndSendMessage(ctx, mode, message, images, files); err != nil {
					return fmt.Errorf("failed to set mode and send message: %w", err)
				}
				fmt.Printf("Mode set to %s and message sent successfully.\n", mode)

			} else {
				if err := taskManager.SendMessage(ctx, message, images, files, approve); err != nil {
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
	cmd.Flags().StringVarP(&approve, "approve", "a", "", "approve (true) or deny (false) pending request")

	return cmd
}

func newTaskFollowCommand() *cobra.Command {
	var address string

	cmd := &cobra.Command{
		Use:     "follow",
		Aliases: []string{"f"},
		Short:   "Follow current task conversation in real-time",
		Long:    `Follow the current task conversation, displaying new messages as they arrive in real-time.`,
		Args:    cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()

			if err := ensureTaskManager(ctx, address); err != nil {
				return err
			}
			
			return taskManager.FollowConversation(ctx, taskManager.GetCurrentInstance())
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
	var address string

	cmd := &cobra.Command{
		Use:     "list",
		Aliases: []string{"l"},
		Short:   "List recent task history",
		Long:    `Display recent tasks from task history.`,
		Args:    cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()

			// Ensure task manager is initialized
			if err := ensureTaskManager(ctx, address); err != nil {
				return err
			}

			fmt.Printf("Using instance: %s\n", taskManager.GetCurrentInstance())

			return taskManager.ListTasks(ctx)
		},
	}

	cmd.Flags().StringVar(&address, "address", "", "specific Cline instance address to use")
	return cmd
}

func newTaskResumeCommand() *cobra.Command {
	var address string

	cmd := &cobra.Command{
		Use:     "resume <task-id>",
		Aliases: []string{"r"},
		Short:   "Resume a task by ID",
		Long:    `Resume an existing task by ID.`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()
			taskID := args[0]

			// Ensure task manager is initialized
			if err := ensureTaskManager(ctx, address); err != nil {
				return err
			}

			fmt.Printf("Using instance: %s\n", taskManager.GetCurrentInstance())

			return taskManager.ResumeTask(ctx, taskID)
		},
	}

	cmd.Flags().StringVar(&address, "address", "", "specific Cline instance address to use")
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
