package cli

import (
	"context"
	"fmt"
	"os"
	"strings"
	"syscall"
	"text/tabwriter"
	"time"

	"github.com/cline/cli/pkg/cli/display"
	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/grpc-go/cline"
	"github.com/spf13/cobra"
	"google.golang.org/grpc/health/grpc_health_v1"
)

func NewInstanceCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "instance",
		Aliases: []string{"i"},
		Short:   "Manage Cline instances",
		Long:    `List and manage multiple Cline instances similar to kubectl contexts.`,
	}

	cmd.AddCommand(newInstanceListCommand())
	cmd.AddCommand(newInstanceUseCommand())
	cmd.AddCommand(newInstanceNewCommand())
	cmd.AddCommand(newInstanceKillCommand())

	return cmd
}

func newInstanceKillCommand() *cobra.Command {
	var killAll bool

	cmd := &cobra.Command{
		Use:     "kill <address>",
		Aliases: []string{"k"},
		Short:   "Kill a Cline instance by address",
		Long:    `Kill a running Cline instance and clean up its registry entry.`,
		Args: func(cmd *cobra.Command, args []string) error {
			if killAll && len(args) > 0 {
				return fmt.Errorf("cannot specify both --all flag and address argument")
			}
			if !killAll && len(args) != 1 {
				return fmt.Errorf("requires exactly one address argument when --all is not specified")
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			if global.Clients == nil {
				return fmt.Errorf("clients not initialized")
			}

			ctx := cmd.Context()
			registry := global.Clients.GetRegistry()

			if killAll {
				return killAllInstances(ctx, registry)
			} else {
				return global.KillInstanceByAddress(ctx, registry, args[0])
			}
		},
	}

	cmd.Flags().BoolVar(&killAll, "all", false, "kill all running instances")

	return cmd
}

func killAllInstances(ctx context.Context, registry *global.ClientRegistry) error {
	// Get all instances from registry
	instances, err := registry.ListInstancesCleaned(ctx)
	if err != nil {
		return fmt.Errorf("failed to list instances: %w", err)
	}

	if len(instances) == 0 {
		fmt.Println("No Cline instances found to kill.")
		return nil
	}

	fmt.Printf("Killing %d instances...\n", len(instances))

	var killResults []killResult

	// Kill all instances
	for _, instance := range instances {
		result := killInstanceProcess(ctx, registry, instance.Address)
		killResults = append(killResults, result)

		if result.err != nil {
			fmt.Printf("✗ Failed to kill %s: %v\n", instance.Address, result.err)
		} else if result.alreadyDead {
			fmt.Printf("⚠ Instance %s appears to be already dead\n", instance.Address)
		} else {
			fmt.Printf("✓ Killed %s (PID %d)\n", instance.Address, result.pid)
		}
	}

	// Wait for all instances to clean up their registry entries
	fmt.Printf("Waiting for instances to clean up registry entries...\n")

	maxWaitTime := 10 // seconds
	for i := 0; i < maxWaitTime; i++ {
		time.Sleep(1 * time.Second)

		remainingInstances, err := registry.ListInstancesCleaned(ctx)
		if err != nil {
			fmt.Printf("Warning: failed to check registry status: %v\n", err)
			continue
		}

		if len(remainingInstances) == 0 {
			fmt.Printf("✓ All instances successfully removed from registry.\n")
			break
		}

		if i == maxWaitTime-1 {
			fmt.Printf("⚠ %d instances still in registry after %d seconds\n", len(remainingInstances), maxWaitTime)
			for _, remaining := range remainingInstances {
				fmt.Printf("  - %s\n", remaining.Address)
			}
		}
	}

	// Print summary
	successful := 0
	failed := 0
	alreadyDead := 0

	for _, result := range killResults {
		if result.err != nil {
			failed++
		} else if result.alreadyDead {
			alreadyDead++
		} else {
			successful++
		}
	}

	fmt.Printf("\nSummary: ")
	if successful > 0 {
		fmt.Printf("Successfully killed %d instances. ", successful)
	}
	if alreadyDead > 0 {
		fmt.Printf("%d were already dead. ", alreadyDead)
	}
	if failed > 0 {
		fmt.Printf("%d failures.", failed)
		return fmt.Errorf("failed to kill %d out of %d instances", failed, len(instances))
	}
	fmt.Println()

	return nil
}

type killResult struct {
	address     string
	pid         int
	alreadyDead bool
	err         error
}

func killInstanceProcess(ctx context.Context, registry *global.ClientRegistry, address string) killResult {
	// Get gRPC client and process info
	client, err := registry.GetClient(ctx, address)
	if err != nil {
		return killResult{address: address, alreadyDead: true, err: nil}
	}

	processInfo, err := client.State.GetProcessInfo(ctx, &cline.EmptyRequest{})
	if err != nil {
		return killResult{address: address, alreadyDead: true, err: nil}
	}

	pid := int(processInfo.ProcessId)

	// Kill the process
	if err := syscall.Kill(pid, syscall.SIGTERM); err != nil {
		return killResult{address: address, pid: pid, err: err}
	}

	return killResult{address: address, pid: pid, err: nil}
}

func newInstanceListCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "list",
		Aliases: []string{"l"},
		Short:   "List all registered Cline instances",
		Long:    `List all registered Cline instances with their status and connection details.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if global.Clients == nil {
				return fmt.Errorf("clients not initialized")
			}

			ctx := cmd.Context()
			registry := global.Clients.GetRegistry()

			// Load, cleanup stale local entries, and update health
			instances, err := registry.ListInstancesCleaned(ctx)
			if err != nil {
				return fmt.Errorf("failed to list instances: %w", err)
			}
			defaultInstance := registry.GetDefaultInstance()

			if len(instances) == 0 {
				fmt.Println("No Cline instances found.")
				fmt.Println("Run 'cline instance new' to start a new instance, or 'cline task new \"...\"' to auto-start one.")
				return nil
			}

			// Build instance data
			type instanceRow struct {
				address  string
				status   string
				version  string
				lastSeen string
				pid      string
				isDefault string
			}

			var rows []instanceRow
			for _, instance := range instances {
				isDefault := ""
				if instance.Address == defaultInstance {
					isDefault = "✓"
				}

				lastSeen := instance.LastSeen.Format("15:04:05")
				if time.Since(instance.LastSeen) > 24*time.Hour {
					lastSeen = instance.LastSeen.Format("2006-01-02")
				}

				// Get PID via RPC if instance is healthy
				pid := "N/A"
				if instance.Status == grpc_health_v1.HealthCheckResponse_SERVING {
					if client, err := registry.GetClient(ctx, instance.Address); err == nil {
						if processInfo, err := client.State.GetProcessInfo(ctx, &cline.EmptyRequest{}); err == nil {
							pid = fmt.Sprintf("%d", processInfo.ProcessId)
							// Update version from RPC if available
							if processInfo.Version != nil && *processInfo.Version != "" && *processInfo.Version != "unknown" {
								instance.Version = *processInfo.Version
							}
						}
					}
				}

				rows = append(rows, instanceRow{
					address:  instance.Address,
					status:   instance.Status.String(),
					version:  instance.Version,
					lastSeen: lastSeen,
					pid:      pid,
					isDefault: isDefault,
				})
			}

			// Check output format
			if global.Config.OutputFormat == "plain" {
				// Use tabwriter for plain output
				w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
				fmt.Fprintln(w, "ADDRESS\tSTATUS\tVERSION\tLAST SEEN\tPID\tDEFAULT")

				for _, row := range rows {
					fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\n",
						row.address,
						row.status,
						row.version,
						row.lastSeen,
						row.pid,
						row.isDefault,
					)
				}

				w.Flush()
			} else {
				// Use markdown table for rich output
				var markdown strings.Builder
				markdown.WriteString("| **ADDRESS (ID)** | **STATUS** | **VERSION** | **LAST SEEN** | **PID** | **DEFAULT** |\n")
				markdown.WriteString("|---------|--------|---------|-----------|-----|---------|")

				for _, row := range rows {
					markdown.WriteString(fmt.Sprintf("\n| %s | %s | %s | %s | %s | %s |",
						row.address,
						row.status,
						row.version,
						row.lastSeen,
						row.pid,
						row.isDefault,
					))
				}

				// Render the markdown table with terminal width for nice table layout
				renderer, err := display.NewMarkdownRendererForTerminal()
				if err != nil {
					// Fallback to plain table if markdown renderer fails
					fmt.Println(markdown.String())
				} else {
					rendered, err := renderer.Render(markdown.String())
					if err != nil {
						fmt.Println(markdown.String())
					} else {
						// Post-process to colorize status values
						rendered = strings.ReplaceAll(rendered, "SERVING", "\033[32mSERVING\033[0m")       		// Green
						rendered = strings.ReplaceAll(rendered, "✓", "\033[32m✓\033[0m")       			   		// Green
						rendered = strings.ReplaceAll(rendered, "NOT_SERVING", "\033[31mNOT_SERVING\033[0m") 	// Red
						rendered = strings.ReplaceAll(rendered, "UNKNOWN", "\033[33mUNKNOWN\033[0m")      		// Yellow


						fmt.Print(strings.TrimLeft(rendered, "\n"))
					}
					fmt.Println("\n")
				}
			}

			return nil
		},
	}

	return cmd
}

func newInstanceUseCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "use <address>",
		Aliases: []string{"u"},
		Short:   "Set the default Cline instance",
		Long:    `Set the default Cline instance to use for subsequent commands.`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			address := args[0]

			if global.Clients == nil {
				return fmt.Errorf("clients not initialized")
			}

			registry := global.Clients.GetRegistry()

			// Verify the instance exists
			_, err := registry.GetInstance(address)
			if err != nil {
				return fmt.Errorf("instance %s not found. Run 'cline instance list' to see available instances", address)
			}

			// Set as default
			if err := registry.SetDefaultInstance(address); err != nil {
				return fmt.Errorf("failed to set default instance: %w", err)
			}

			fmt.Printf("Switched to instance: %s\n", address)
			return nil
		},
	}

	return cmd
}

func newInstanceNewCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "new",
		Aliases: []string{"n"},
		Short:   "Create a new Cline instance",
		Long:    `Create a new Cline instance with automatically assigned ports.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()

			if global.Clients == nil {
				return fmt.Errorf("clients not initialized")
			}

			fmt.Println("Starting new Cline instance...")

			instance, err := global.Clients.StartNewInstance(ctx)
			if err != nil {
				return fmt.Errorf("failed to start instance: %w", err)
			}

			fmt.Printf("Successfully started new instance:\n")
			fmt.Printf("  Address: %s\n", instance.Address)
			fmt.Printf("  Core Port: %d\n", instance.CorePort())
			fmt.Printf("  Host Bridge Port: %d\n", instance.HostPort())

			// Check if this is now the default instance
			registry := global.Clients.GetRegistry()
			if registry.GetDefaultInstance() == instance.Address {
				fmt.Printf("  Status: Default instance\n")
			}

			return nil
		},
	}

	return cmd
}
