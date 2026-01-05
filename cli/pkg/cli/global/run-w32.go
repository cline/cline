//go:build windows

package global

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"

	"github.com/cline/grpc-go/cline"
)

func startClineHost(hostPort int, workspaces []string) (*exec.Cmd, error) {
	if Config.Verbose {
		fmt.Printf("Starting cline-host on port %d\n", hostPort)
	}

	// Get the directory where the cline binary is located
	execPath, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("failed to get executable path: %w", err)
	}
	binDir := filepath.Dir(execPath)
	clineHostPath := filepath.Join(binDir, "cline-host.exe")

	// Build command arguments
	args := []string{
		"--verbose",
		"--port", fmt.Sprintf("%d", hostPort),
	}

	for _, ws := range workspaces {
		args = append(args, "--workspace", ws)
	}

	// Start the cline-host process
	cmd := exec.Command(clineHostPath, args...)

	// Create logs directory in ~/.cline/logs
	logsDir := filepath.Join(Config.ConfigPath, "logs")
	if err := os.MkdirAll(logsDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create logs directory: %w", err)
	}

	// Create timestamped log file
	timestamp := time.Now().Format("2006-01-02-15-04-05")
	logFileName := fmt.Sprintf("cline-host-%s-localhost-%d.log", timestamp, hostPort)
	logFilePath := filepath.Join(logsDir, logFileName)
	logFile, err := os.Create(logFilePath)
	if err != nil {
		return nil, fmt.Errorf("failed to create log file: %w", err)
	}

	// Redirect stdout and stderr to log file
	cmd.Stdout = logFile
	cmd.Stderr = logFile

	// Put the child process in a new process group so Ctrl+C doesn't kill it
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP,
	}

	if err := cmd.Start(); err != nil {
		logFile.Close()
		return nil, fmt.Errorf("failed to start cline-host: %w", err)
	}

	if Config.Verbose {
		fmt.Printf("Started cline-host (PID: %d)\n", cmd.Process.Pid)
		fmt.Printf("Logging cline-host output to: %s\n", logFilePath)
	}
	return cmd, nil
}

// KillInstanceByAddress kills a Cline instance by its address
func KillInstanceByAddress(ctx context.Context, registry *ClientRegistry, address string) error {
	// Check if the instance exists in the registry
	_, err := registry.GetInstance(address)
	if err != nil {
		return fmt.Errorf("instance %s not found in registry", address)
	}

	if Config.Verbose {
		fmt.Printf("Killing instance: %s\n", address)
	}

	// Get gRPC client and process info
	client, err := registry.GetClient(ctx, address)
	if err != nil {
		return fmt.Errorf("failed to connect to instance %s: %w", address, err)
	}

	processInfo, err := client.State.GetProcessInfo(ctx, &cline.EmptyRequest{})
	if err != nil {
		return fmt.Errorf("failed to get process info for instance %s: %w", address, err)
	}

	pid := int(processInfo.ProcessId)
	if Config.Verbose {
		fmt.Printf("Terminating process PID %d...\n", pid)
	}

	// Find and kill the process using os.Process
	// On Windows, os.Process.Kill() properly calls TerminateProcess with the correct handle
	process, err := os.FindProcess(pid)
	if err != nil {
		return fmt.Errorf("failed to find process %d: %w", pid, err)
	}

	if err := process.Kill(); err != nil {
		return fmt.Errorf("failed to kill process %d: %w", pid, err)
	}

	// Wait for the instance to remove itself from registry
	if Config.Verbose {
		fmt.Printf("Waiting for instance to clean up registry entry...\n")
	}
	for range 5 {
		time.Sleep(1 * time.Second)
		if !registry.HasInstanceAtAddress(address) {
			if Config.Verbose {
				fmt.Printf("Instance %s successfully killed and removed from registry.\n", address)
			}

			// Update default instance if needed
			instances, err := registry.ListInstancesCleaned(ctx)
			if err == nil && len(instances) > 0 {
				// ensureDefaultInstance logic will handle setting a new default
				defaultInstance := registry.GetDefaultInstance()
				if defaultInstance == address || defaultInstance == "" {
					if len(instances) > 0 {
						if err := registry.SetDefaultInstance(instances[0].Address); err == nil {
							if Config.Verbose {
								fmt.Printf("Updated default instance to: %s\n", instances[0].Address)
							}
						}
					}
				}
			}

			return nil
		}
	}

	return fmt.Errorf("instance killed but failed to remove itself from registry within 5 seconds")
}

func startClineCore(corePort, hostPort int) (*exec.Cmd, error) {
	if Config.Verbose {
		fmt.Printf("Starting cline-core on port %d (with hostbridge on %d)\n", corePort, hostPort)
	}

	// Get the executable path and resolve symlinks (for npm global installs)
	execPath, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("failed to get executable path: %w", err)
	}

	// Resolve symlinks to get the real path
	// For npm global installs, execPath might be a symlink like:
	// /opt/homebrew/bin/cline -> /opt/homebrew/lib/node_modules/cline/bin/cline
	realPath, err := filepath.EvalSymlinks(execPath)
	if err != nil {
		// If we can't resolve symlinks, fall back to the original path
		realPath = execPath
		if Config.Verbose {
			fmt.Printf("Warning: Could not resolve symlinks for %s: %v\n", execPath, err)
		}
	}

	binDir := filepath.Dir(realPath)
	installDir := filepath.Dir(binDir)
	clineCorePath := filepath.Join(installDir, "cline-core.js")

	if Config.Verbose {
		fmt.Printf("Executable path: %s\n", execPath)
		if realPath != execPath {
			fmt.Printf("Real path (after resolving symlinks): %s\n", realPath)
		}
		fmt.Printf("Bin directory: %s\n", binDir)
		fmt.Printf("Install directory: %s\n", installDir)
		fmt.Printf("Looking for cline-core.js at: %s\n", clineCorePath)
	}

	// Check if cline-core.js exists at the primary location
	var finalClineCorePath string
	var finalInstallDir string
	if _, err := os.Stat(clineCorePath); os.IsNotExist(err) {
		// Development mode: Try ../../dist-standalone/cline-core.js
		// This handles the case where we're running from cli/bin/cline
		devClineCorePath := filepath.Join(binDir, "..", "..", "dist-standalone", "cline-core.js")
		devInstallDir := filepath.Join(binDir, "..", "..", "dist-standalone")

		if Config.Verbose {
			fmt.Printf("Primary location not found, trying development path: %s\n", devClineCorePath)
		}

		if _, err := os.Stat(devClineCorePath); os.IsNotExist(err) {
			return nil, fmt.Errorf("cline-core.js not found at '%s' or '%s'. Please ensure you're running from the correct location or reinstall with 'npm install -g cline'", clineCorePath, devClineCorePath)
		}

		finalClineCorePath = devClineCorePath
		finalInstallDir = devInstallDir
		if Config.Verbose {
			fmt.Printf("Using development mode: cline-core.js found at %s\n", finalClineCorePath)
		}
	} else {
		finalClineCorePath = clineCorePath
		finalInstallDir = installDir
		if Config.Verbose {
			fmt.Printf("Using production mode: cline-core.js found at %s\n", finalClineCorePath)
		}
	}

	// Create logs directory in ~/.cline/logs
	logsDir := filepath.Join(Config.ConfigPath, "logs")
	if err := os.MkdirAll(logsDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create logs directory: %w", err)
	}

	// Create timestamped log file
	timestamp := time.Now().Format("2006-01-02-15-04-05")
	logFileName := fmt.Sprintf("cline-core-%s-localhost-%d.log", timestamp, corePort)
	logFilePath := filepath.Join(logsDir, logFileName)
	logFile, err := os.Create(logFilePath)
	if err != nil {
		return nil, fmt.Errorf("failed to create log file: %w", err)
	}

	// Start the cline-core process with --config flag using system node
	args := []string{finalClineCorePath,
		"--port", fmt.Sprintf("%d", corePort),
		"--host-bridge-port", fmt.Sprintf("%d", hostPort),
		"--config", Config.ConfigPath}

	if Config.Verbose {
		fmt.Printf("Using system node\n")
	}

	cmd := exec.Command("node", args...)

	// Set working directory to installation root
	cmd.Dir = finalInstallDir

	// Redirect stdout and stderr to log file
	cmd.Stdout = logFile
	cmd.Stderr = logFile

	// Put the child process in a new process group so Ctrl+C doesn't kill it
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP,
	}

	// Set environment variables with NODE_PATH for both real and fake node_modules
	// The fake node_modules contains the vscode stub that can't be in the real node_modules
	env := os.Environ()
	realNodeModules := filepath.Join(finalInstallDir, "node_modules")
	fakeNodeModules := filepath.Join(finalInstallDir, "fake_node_modules")
	nodePath := fmt.Sprintf("%s%c%s", realNodeModules, os.PathListSeparator, fakeNodeModules)

	env = append(env,
		fmt.Sprintf("NODE_PATH=%s", nodePath),
		// These control gRPC debug logging
		//"GRPC_TRACE=all",
		//"GRPC_VERBOSITY=DEBUG",
		"NODE_ENV=development",
	)
	cmd.Env = env

	if Config.Verbose {
		fmt.Printf("NODE_PATH set to: %s\n", nodePath)
	}

	if err := cmd.Start(); err != nil {
		logFile.Close()
		return nil, fmt.Errorf("failed to start cline-core: %w", err)
	}

	if Config.Verbose {
		fmt.Printf("Started cline-core (PID: %d)\n", cmd.Process.Pid)
		fmt.Printf("Logging cline-core output to: %s\n", logFilePath)
	}
	return cmd, nil
}
