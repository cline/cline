package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"syscall"
	"text/tabwriter"
	"time"

	"github.com/cline/cli/pkg/cli/display"
	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/cli/pkg/cli/output"
	"github.com/cline/cli/pkg/common"
	client2 "github.com/cline/grpc-go/client"
	"github.com/cline/grpc-go/cline"
	"github.com/spf13/cobra"
	"google.golang.org/grpc/health/grpc_health_v1"
)

const (
	platformCLI       = "CLI"
	platformJetBrains = "JetBrains"
	platformNA        = "N/A"
	hostPlatformCLI   = "Cline CLI" // Value returned by host bridge for CLI instances
)

// detectInstancePlatform connects to an instance's host bridge and determines its platform
func detectInstancePlatform(ctx context.Context, instance *common.CoreInstanceInfo) (string, error) {
	hostTarget, err := common.NormalizeAddressForGRPC(instance.HostServiceAddress)
	if err != nil {
		return platformNA, err
	}

	hostClient, err := client2.NewClineClient(hostTarget)
	if err != nil {
		return platformNA, err
	}
	defer hostClient.Disconnect()

	if err := hostClient.Connect(ctx); err != nil {
		return platformNA, err
	}

	hostVersion, err := hostClient.Env.GetHostVersion(ctx, &cline.EmptyRequest{})
	if err != nil {
		return platformNA, err
	}

	if hostVersion.Platform == nil {
		return platformNA, fmt.Errorf("host returned nil platform")
	}

	platformStr := *hostVersion.Platform
	if platformStr == hostPlatformCLI {
		return platformCLI, nil
	}
	return platformJetBrains, nil
}

func NewInstanceCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "instance",
		Aliases: []string{"i"},
		Short:   "Manage Cline instances",
		Long:    `List and manage multiple Cline instances similar to kubectl contexts.`,
	}

	cmd.AddCommand(newInstanceListCommand())
	cmd.AddCommand(newInstanceDefaultCommand())
	cmd.AddCommand(newInstanceNewCommand())
	cmd.AddCommand(newInstanceKillCommand())

	return cmd
}

func newInstanceKillCommand() *cobra.Command {
	var killAllCLI bool

	cmd := &cobra.Command{
		Use:     "kill <address>",
		Aliases: []string{"k"},
		Short:   "Kill a Cline instance by address",
		Long:    `Kill a running Cline instance and clean up its registry entry.`,
		Args: func(cmd *cobra.Command, args []string) error {
			if killAllCLI && len(args) > 0 {
				return fmt.Errorf("cannot specify both --all-cli flag and address argument")
			}
			if !killAllCLI && len(args) != 1 {
				return fmt.Errorf("requires exactly one address argument when --all-cli is not specified")
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			if global.Clients == nil {
				return fmt.Errorf("clients not initialized")
			}

			ctx := cmd.Context()
			registry := global.Clients.GetRegistry()

			if killAllCLI {
				return killAllCLIInstances(ctx, registry)
			} else {
				address := args[0]
				if err := global.KillInstanceByAddress(ctx, registry, address); err != nil {
					return err
				}

				// Output success in JSON or plain text
				if global.Config.OutputFormat == "json" {
					data := map[string]interface{}{
						"killedCount": 1,
						"addresses":   []string{address},
					}
					return output.OutputJSONSuccess("instance kill", data)
				}

				fmt.Printf("Successfully killed instance at %s\n", address)
				return nil
			}
		},
	}

	cmd.Flags().BoolVarP(&killAllCLI, "all-cli", "a", false, "kill all running CLI instances (excludes JetBrains)")

	return cmd
}

func killAllCLIInstances(ctx context.Context, registry *global.ClientRegistry) error {
	// Get all instances from registry
	instances, err := registry.ListInstancesCleaned(ctx)
	if err != nil {
		return fmt.Errorf("failed to list instances: %w", err)
	}

	if len(instances) == 0 {
		if global.Config.OutputFormat == "json" {
			data := map[string]interface{}{
				"killedCount":      0,
				"alreadyDeadCount": 0,
				"failedCount":      0,
				"skippedCount":     0,
				"addresses":        []string{},
			}
			return output.OutputJSONSuccess("instance kill", data)
		}
		fmt.Println("No Cline instances found to kill.")
		return nil
	}

	// Filter to only CLI instances
	var cliInstances []*common.CoreInstanceInfo
	var skippedNonCLI int
	var skippedAddresses []string
	for _, instance := range instances {
		if instance.Status == grpc_health_v1.HealthCheckResponse_SERVING {
			platform, err := detectInstancePlatform(ctx, instance)
			if err == nil {
				if platform == platformCLI {
					cliInstances = append(cliInstances, instance)
				} else {
					skippedNonCLI++
					skippedAddresses = append(skippedAddresses, instance.Address)
					if global.Config.OutputFormat != "json" {
						fmt.Printf("⊘ Skipping %s instance: %s\n", platform, instance.Address)
					}
				}
			}
		}
	}

	if len(cliInstances) == 0 {
		if global.Config.OutputFormat == "json" {
			data := map[string]interface{}{
				"killedCount":      0,
				"alreadyDeadCount": 0,
				"failedCount":      0,
				"skippedCount":     skippedNonCLI,
				"addresses":        []string{},
				"skippedAddresses": skippedAddresses,
			}
			return output.OutputJSONSuccess("instance kill", data)
		}
		
		if skippedNonCLI > 0 {
			fmt.Printf("No CLI instances to kill. Skipped %d JetBrains instance(s).\n", skippedNonCLI)
		} else {
			fmt.Println("No CLI instances found to kill.")
		}
		return nil
	}

	if global.Config.OutputFormat != "json" {
		fmt.Printf("Killing %d CLI instance(s)...\n", len(cliInstances))
		if skippedNonCLI > 0 {
			fmt.Printf("Skipping %d JetBrains instance(s).\n", skippedNonCLI)
		}
	}

	var killResults []killResult
	killedAddresses := make(map[string]bool)
	var killedAddressList []string

	// Kill all CLI instances
	for _, instance := range cliInstances {
		result := killInstanceProcess(ctx, registry, instance.Address)
		killResults = append(killResults, result)

		if global.Config.OutputFormat != "json" {
			if result.err != nil {
				fmt.Printf("✗ Failed to kill %s: %v\n", instance.Address, result.err)
			} else if result.alreadyDead {
				fmt.Printf("⚠ Instance %s appears to be already dead\n", instance.Address)
			} else {
				fmt.Printf("✓ Killed %s (PID %d)\n", instance.Address, result.pid)
				killedAddresses[instance.Address] = true
				killedAddressList = append(killedAddressList, instance.Address)
			}
		} else {
			if !result.alreadyDead && result.err == nil {
				killedAddresses[instance.Address] = true
				killedAddressList = append(killedAddressList, instance.Address)
			}
		}
	}

	// Wait for killed instances to clean up their registry entries
	if len(killedAddresses) > 0 {
		if global.Config.OutputFormat != "json" {
			fmt.Printf("Waiting for instances to clean up registry entries...\n")
		}

		maxWaitTime := 10 // seconds
		for i := 0; i < maxWaitTime; i++ {
			time.Sleep(1 * time.Second)

			remainingInstances, err := registry.ListInstancesCleaned(ctx)
			if err != nil {
				if global.Config.OutputFormat != "json" {
					fmt.Printf("Warning: failed to check registry status: %v\n", err)
				}
				continue
			}

			// Check if any of the killed instances are still in the registry
			stillPresent := []string{}
			for _, remaining := range remainingInstances {
				if killedAddresses[remaining.Address] {
					stillPresent = append(stillPresent, remaining.Address)
				}
			}

			if len(stillPresent) == 0 {
				if global.Config.OutputFormat != "json" {
					fmt.Printf("✓ All killed instances successfully removed from registry.\n")
				}
				break
			}

			if i == maxWaitTime-1 && global.Config.OutputFormat != "json" {
				fmt.Printf("⚠ %d killed instance(s) still in registry after %d seconds\n", len(stillPresent), maxWaitTime)
				for _, addr := range stillPresent {
					fmt.Printf("  - %s\n", addr)
				}
			}
		}
	}

	// Count results
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

	// Output results
	if global.Config.OutputFormat == "json" {
		data := map[string]interface{}{
			"killedCount":      successful,
			"alreadyDeadCount": alreadyDead,
			"failedCount":      failed,
			"skippedCount":     skippedNonCLI,
			"addresses":        killedAddressList,
		}
		if len(skippedAddresses) > 0 {
			data["skippedAddresses"] = skippedAddresses
		}
		if failed > 0 {
			return fmt.Errorf("failed to kill %d out of %d instances", failed, len(cliInstances))
		}
		return output.OutputJSONSuccess("instance kill", data)
	}

	// Plain text summary
	fmt.Printf("\nSummary: ")
	if successful > 0 {
		fmt.Printf("Successfully killed %d instances. ", successful)
	}
	if alreadyDead > 0 {
		fmt.Printf("%d were already dead. ", alreadyDead)
	}
	if failed > 0 {
		fmt.Printf("%d failures.", failed)
		return fmt.Errorf("failed to kill %d out of %d instances", failed, len(cliInstances))
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
				if global.Config.OutputFormat == "json" {
					data := map[string]interface{}{
						"defaultInstance": defaultInstance,
						"instances":       []interface{}{},
					}
					return output.OutputJSONSuccess("instance list", data)
				}
				fmt.Println("No Cline instances found.")
				fmt.Println("Run 'cline instance new' to start a new instance, or 'cline task new \"...\"' to auto-start one.")
				return nil
			}

			// Build instance data
			type instanceData struct {
				Address   string `json:"address"`
				Status    string `json:"status"`
				Version   string `json:"version"`
				LastSeen  string `json:"lastSeen"`
				PID       string `json:"pid"`
				Platform  string `json:"platform"`
				IsDefault bool   `json:"isDefault"`
			}

			var instanceList []instanceData
			for _, instance := range instances {
				isDefaultBool := instance.Address == defaultInstance

				lastSeen := instance.LastSeen.Format(time.RFC3339)

				// Get PID and platform via RPC if instance is healthy
				pid := platformNA
				platform := platformNA
				if instance.Status == grpc_health_v1.HealthCheckResponse_SERVING {
					// Get PID from core
					if client, err := registry.GetClient(ctx, instance.Address); err == nil {
						if processInfo, err := client.State.GetProcessInfo(ctx, &cline.EmptyRequest{}); err == nil {
							pid = fmt.Sprintf("%d", processInfo.ProcessId)
							// Update version from RPC if available
							if processInfo.Version != nil && *processInfo.Version != "" && *processInfo.Version != "unknown" {
								instance.Version = *processInfo.Version
							}
						}
					}

					// Get platform from host bridge
					if detectedPlatform, err := detectInstancePlatform(ctx, instance); err == nil {
						platform = detectedPlatform
					}
				}

				instanceList = append(instanceList, instanceData{
					Address:   instance.Address,
					Status:    instance.Status.String(),
					Version:   instance.Version,
					LastSeen:  lastSeen,
					PID:       pid,
					Platform:  platform,
					IsDefault: isDefaultBool,
				})
			}

			// Check for JSON output mode first
			if global.Config.OutputFormat == "json" {
				data := map[string]interface{}{
					"defaultInstance": defaultInstance,
					"instances":       instanceList,
				}
				return output.OutputJSONSuccess("instance list", data)
			}

			// Check output format for plain/rich
			if global.Config.OutputFormat == "plain" {
				// Use tabwriter for plain output
				w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
				fmt.Fprintln(w, "ADDRESS\tSTATUS\tVERSION\tLAST SEEN\tPID\tPLATFORM\tDEFAULT")

				for _, inst := range instanceList {
					isDefaultStr := ""
					if inst.IsDefault {
						isDefaultStr = "✓"
					}
					// Format lastSeen for display
					lastSeenTime, _ := time.Parse(time.RFC3339, inst.LastSeen)
					lastSeenDisplay := lastSeenTime.Format("15:04:05")
					if time.Since(lastSeenTime) > 24*time.Hour {
						lastSeenDisplay = lastSeenTime.Format("2006-01-02")
					}

					fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\t%s\n",
						inst.Address,
						inst.Status,
						inst.Version,
						lastSeenDisplay,
						inst.PID,
						inst.Platform,
						isDefaultStr,
					)
				}

				w.Flush()
			} else {
				// Use markdown table for rich output
				var markdown strings.Builder
				markdown.WriteString("| **ADDRESS (ID)** | **STATUS** | **VERSION** | **LAST SEEN** | **PID** | **PLATFORM** | **DEFAULT** |\n")
				markdown.WriteString("|---------|--------|---------|-----------|-----|----------|---------|")

				for _, inst := range instanceList {
					isDefaultStr := ""
					if inst.IsDefault {
						isDefaultStr = "✓"
					}
					// Format lastSeen for display
					lastSeenTime, _ := time.Parse(time.RFC3339, inst.LastSeen)
					lastSeenDisplay := lastSeenTime.Format("15:04:05")
					if time.Since(lastSeenTime) > 24*time.Hour {
						lastSeenDisplay = lastSeenTime.Format("2006-01-02")
					}

					markdown.WriteString(fmt.Sprintf("\n| %s | %s | %s | %s | %s | %s | %s |",
						inst.Address,
						inst.Status,
						inst.Version,
						lastSeenDisplay,
						inst.PID,
						inst.Platform,
						isDefaultStr,
					))
				}

				// Render the markdown table with terminal width for nice table layout
				mdRenderer, err := display.NewMarkdownRendererForTerminal()
				if err != nil {
					// Fallback to plain table if markdown renderer fails
					fmt.Println(markdown.String())
				} else {
					rendered, err := mdRenderer.Render(markdown.String())
					if err != nil {
						fmt.Println(markdown.String())
					} else {
						// Post-process to colorize status values
						colorRenderer := display.NewRenderer(global.Config.OutputFormat)
						rendered = strings.ReplaceAll(rendered, "SERVING", colorRenderer.Green("SERVING"))
						rendered = strings.ReplaceAll(rendered, "✓", colorRenderer.Green("✓"))
						rendered = strings.ReplaceAll(rendered, "NOT_SERVING", colorRenderer.Red("NOT_SERVING"))
						rendered = strings.ReplaceAll(rendered, "UNKNOWN", colorRenderer.Yellow("UNKNOWN"))

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

func newInstanceDefaultCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "default <address>",
		Aliases: []string{"d"},
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

			// Output success in JSON or plain text
			if global.Config.OutputFormat == "json" {
				data := map[string]interface{}{
					"defaultInstance": address,
				}
				return output.OutputJSONSuccess("instance default", data)
			}

			fmt.Printf("Switched to instance: %s\n", address)
			return nil
		},
	}

	return cmd
}

func newInstanceNewCommand() *cobra.Command {
	var setDefault bool

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

			// Output starting message only in rich/plain mode
			// In JSON mode, we'll only output the final result
			if global.Config.OutputFormat != "json" {
				fmt.Println("Starting new Cline instance...")
			}

			instance, err := global.Clients.StartNewInstance(ctx)
			if err != nil {
				return fmt.Errorf("failed to start instance: %w", err)
			}

			registry := global.Clients.GetRegistry()

			// If --default flag provided, set this instance as the default
			if setDefault {
				if err := registry.SetDefaultInstance(instance.Address); err != nil {
					// Output warning in appropriate format
					if global.Config.OutputFormat == "json" {
						statusMsg := map[string]interface{}{
							"type":    "status",
							"message": fmt.Sprintf("Warning: Failed to set as default: %v", err),
						}
						if jsonBytes, err := json.MarshalIndent(statusMsg, "", "  "); err == nil {
							fmt.Println(string(jsonBytes))
						}
					} else {
						fmt.Printf("Warning: Failed to set as default: %v\n", err)
					}
				}
			}

			// Check if this is the default instance
			isDefault := registry.GetDefaultInstance() == instance.Address

			// Check for JSON output mode
			if global.Config.OutputFormat == "json" {
				data := map[string]interface{}{
					"address":   instance.Address,
					"corePort":  instance.CorePort(),
					"hostPort":  instance.HostPort(),
					"isDefault": isDefault,
				}
				return output.OutputJSONSuccess("instance new", data)
			}

			// Existing rich/plain output
			fmt.Printf("Successfully started new instance:\n")
			fmt.Printf("  Address: %s\n", instance.Address)
			fmt.Printf("  Core Port: %d\n", instance.CorePort())
			fmt.Printf("  Host Bridge Port: %d\n", instance.HostPort())

			if setDefault {
				fmt.Printf("  Status: Set as default instance\n")
			} else if isDefault {
				fmt.Printf("  Status: Default instance\n")
			}

			return nil
		},
	}

	cmd.Flags().BoolVarP(&setDefault, "default", "d", false, "set as default instance")

	return cmd
}
