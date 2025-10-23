package global

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"syscall"
	"time"

	"github.com/cline/cli/pkg/common"
	"github.com/cline/grpc-go/cline"
)

// ClineClients manages Cline instances using the new registry system
type ClineClients struct {
	registry *ClientRegistry
}

// NewClineClients creates a new ClineClients instance
func NewClineClients(configPath string) *ClineClients {
	registry := NewClientRegistry(configPath)
	return &ClineClients{
		registry: registry,
	}
}

// Initialize performs cleanup of stale instances
func (c *ClineClients) Initialize(ctx context.Context) error {
	// Clean up stale entries (direct SQLite operations)
	_ = c.registry.CleanupStaleInstances(ctx)

	return nil
}

// StartNewInstance starts a new Cline instance and waits for cline-core to self-register
func (c *ClineClients) StartNewInstance(ctx context.Context) (*common.CoreInstanceInfo, error) {
	// Find available ports
	corePort, hostPort, err := common.FindAvailablePortPair()
	if err != nil {
		return nil, fmt.Errorf("failed to find available ports: %w", err)
	}

	if Config.Verbose {
		fmt.Printf("Starting new Cline instance on ports %d (core) and %d (host bridge)\n", corePort, hostPort)
	}

	// Start cline-host first
	hostCmd, err := startClineHost(hostPort, corePort)
	if err != nil {
		return nil, fmt.Errorf("failed to start cline-host: %w", err)
	}

	// Start cline-core (it will register itself in SQLite locks database)
	coreCmd, err := startClineCore(corePort, hostPort)
	if err != nil {
		// Clean up host process if core fails to start
		if hostCmd != nil && hostCmd.Process != nil {
			hostCmd.Process.Kill()
		}
		return nil, fmt.Errorf("failed to start cline-core: %w", err)
	}

	fullAddress := fmt.Sprintf("localhost:%d", corePort)
	if Config.Verbose {
		fmt.Println("Waiting for services to start and self-register in SQLite...")
	}

	// Use RetryOperation to wait for instance to be ready
	var instance *common.CoreInstanceInfo
	err = common.RetryOperation(12, 5*time.Second, func() error {
		// Check if instance registered itself in SQLite
		foundInstance, err := c.registry.GetInstance(fullAddress)
		if err != nil || foundInstance == nil {
			return fmt.Errorf("instance not found in registry: %v", err)
		}

		// Verify instance is healthy
		if !common.IsInstanceHealthy(ctx, fullAddress) {
			return fmt.Errorf("instance is registered but not healthy")
		}

		// Success - store the instance for return
		instance = foundInstance
		return nil
	})

	if err != nil {
		// Clean up both processes on failure
		if coreCmd != nil && coreCmd.Process != nil {
			fmt.Printf("Cleaning up core process (PID: %d)\n", coreCmd.Process.Pid)
			coreCmd.Process.Kill()
		}
		if hostCmd != nil && hostCmd.Process != nil {
			fmt.Printf("Cleaning up host process (PID: %d)\n", hostCmd.Process.Pid)
			hostCmd.Process.Kill()
		}
		return nil, fmt.Errorf("failed to start instance: %w", err)
	}

	if Config.Verbose {
		fmt.Println("Services started and registered successfully!")
		fmt.Printf("  Address: %s\n", instance.Address)
		fmt.Printf("  Core Port: %d\n", instance.CorePort())
		fmt.Printf("  Host Bridge Port: %d\n", instance.HostPort())
		fmt.Printf("  Process PID: %d\n", coreCmd.Process.Pid)
	}

	// If this is the first instance, set it as default
	instances := c.registry.ListInstances()
	if err := c.registry.EnsureDefaultInstance(instances); err != nil {
		if Config.Verbose {
			fmt.Printf("Warning: Failed to set default instance: %v\n", err)
		}
	}

	return instance, nil
}

// StartNewInstanceAtPort starts a new Cline instance at the specified port and waits for self-registration
func (c *ClineClients) StartNewInstanceAtPort(ctx context.Context, corePort int) (*common.CoreInstanceInfo, error) {
	// Find available host port (core port + 1000)
	hostPort := corePort + 1000
	coreAddress := fmt.Sprintf("localhost:%d", corePort)

	// Check if the specified core port is available
	if common.IsInstanceHealthy(ctx, coreAddress) {
		return nil, fmt.Errorf("port %d is already in use by another Cline instance", corePort)
	}

	if Config.Verbose {
		fmt.Printf("Starting new Cline instance on ports %d (core) and %d (host bridge)\n", corePort, hostPort)
	}

	// Start cline-host first
	hostCmd, err := startClineHost(hostPort, corePort)
	if err != nil {
		return nil, fmt.Errorf("failed to start cline-host: %w", err)
	}

	// Start cline-core (it will register itself in SQLite locks database)
	coreCmd, err := startClineCore(corePort, hostPort)
	if err != nil {
		// Clean up host process if core fails to start
		if hostCmd != nil && hostCmd.Process != nil {
			hostCmd.Process.Kill()
		}
		return nil, fmt.Errorf("failed to start cline-core: %w", err)
	}

	fullAddress := fmt.Sprintf("localhost:%d", corePort)
	if Config.Verbose {
		fmt.Println("Waiting for services to start and self-register in SQLite...")
	}

	// Use RetryOperation to wait for instance to be ready
	var instance *common.CoreInstanceInfo
	err = common.RetryOperation(12, 5*time.Second, func() error {
		// Check if instance registered itself in SQLite
		foundInstance, err := c.registry.GetInstance(fullAddress)
		if err != nil || foundInstance == nil {
			return fmt.Errorf("instance not found in registry: %v", err)
		}

		// Verify instance is healthy
		if !common.IsInstanceHealthy(ctx, fullAddress) {
			return fmt.Errorf("instance is registered but not healthy")
		}

		// Success - store the instance for return
		instance = foundInstance
		return nil
	})

	if err != nil {
		// Clean up both processes on failure
		if coreCmd != nil && coreCmd.Process != nil {
			fmt.Printf("Cleaning up core process (PID: %d)\n", coreCmd.Process.Pid)
			coreCmd.Process.Kill()
		}
		if hostCmd != nil && hostCmd.Process != nil {
			fmt.Printf("Cleaning up host process (PID: %d)\n", hostCmd.Process.Pid)
			hostCmd.Process.Kill()
		}
		return nil, fmt.Errorf("failed to start instance at port %d: %w", corePort, err)
	}

	if Config.Verbose {
		fmt.Println("Services started and registered successfully!")
		fmt.Printf("  Address: %s\n", instance.Address)
		fmt.Printf("  Core Port: %d\n", instance.CorePort())
		fmt.Printf("  Host Bridge Port: %d\n", instance.HostPort())
		fmt.Printf("  Process PID: %d\n", coreCmd.Process.Pid)
	}

	// If this is the first instance, set it as default
	instances := c.registry.ListInstances()
	if err := c.registry.EnsureDefaultInstance(instances); err != nil {
		if Config.Verbose {
			fmt.Printf("Warning: Failed to set default instance: %v\n", err)
		}
	}

	return instance, nil
}

// GetRegistry returns the client registry
func (c *ClineClients) GetRegistry() *ClientRegistry {
	return c.registry
}

// EnsureInstanceAtAddress ensures an instance exists at the given address, starting one if needed
func (c *ClineClients) EnsureInstanceAtAddress(ctx context.Context, address string) error {
	// Expect host:port everywhere
	normalized := address
	if normalized == "" {
		normalized = fmt.Sprintf("localhost:%d", common.DEFAULT_CLINE_CORE_PORT)
	}

	// Check if instance already exists at this address
	if c.registry.HasInstanceAtAddress(normalized) {
		return nil
	}

	// Parse host:port
	host, port, err := common.ParseHostPort(normalized)
	if err != nil {
		return fmt.Errorf("invalid address format %s", address)
	}

	// Use IPv6-compatible localhost detection
	if common.IsLocalAddress(host) {
		_, err := c.StartNewInstanceAtPort(ctx, port)
		if err != nil {
			return fmt.Errorf("failed to start new instance at %s: %w", normalized, err)
		}
		return nil
	}

	return fmt.Errorf("cannot start remote instance at %s", normalized)
}

func startClineHost(hostPort, corePort int) (*exec.Cmd, error) {
	if Config.Verbose {
		fmt.Printf("Starting cline-host on port %d\n", hostPort)
	}

	// Get the directory where the cline binary is located
	execPath, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("failed to get executable path: %w", err)
	}
	binDir := path.Dir(execPath)
	clineHostPath := path.Join(binDir, "cline-host")

	// Start the cline-host process
	cmd := exec.Command(clineHostPath,
		"--verbose",
		"--port", fmt.Sprintf("%d", hostPort))

	// Create logs directory in ~/.cline/logs
	logsDir := path.Join(Config.ConfigPath, "logs")
	if err := os.MkdirAll(logsDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create logs directory: %w", err)
	}

	// Create timestamped log file
	timestamp := time.Now().Format("2006-01-02-15-04-05")
	logFileName := fmt.Sprintf("cline-host-%s-localhost-%d.log", timestamp, hostPort)
	logFilePath := path.Join(logsDir, logFileName)
	logFile, err := os.Create(logFilePath)
	if err != nil {
		return nil, fmt.Errorf("failed to create log file: %w", err)
	}

	// Redirect stdout and stderr to log file
	cmd.Stdout = logFile
	cmd.Stderr = logFile

	// Put the child process in a new process group so Ctrl+C doesn't kill it
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setpgid: true,
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

	// Kill the process
	if err := syscall.Kill(pid, syscall.SIGTERM); err != nil {
		return fmt.Errorf("failed to kill process %d: %w", pid, err)
	}

	// Wait for the instance to remove itself from registry
	if Config.Verbose {
		fmt.Printf("Waiting for instance to clean up registry entry...\n")
	}
	for i := 0; i < 5; i++ {
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

	binDir := path.Dir(realPath)
	installDir := path.Dir(binDir)
	clineCorePath := path.Join(installDir, "cline-core.js")

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
		devClineCorePath := path.Join(binDir, "..", "..", "dist-standalone", "cline-core.js")
		devInstallDir := path.Join(binDir, "..", "..", "dist-standalone")
		
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
	logsDir := path.Join(Config.ConfigPath, "logs")
	if err := os.MkdirAll(logsDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create logs directory: %w", err)
	}

	// Create timestamped log file
	timestamp := time.Now().Format("2006-01-02-15-04-05")
	logFileName := fmt.Sprintf("cline-core-%s-localhost-%d.log", timestamp, corePort)
	logFilePath := path.Join(logsDir, logFileName)
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
		Setpgid: true,
	}

	// Set environment variables with NODE_PATH for both real and fake node_modules
	// The fake node_modules contains the vscode stub that can't be in the real node_modules
	env := os.Environ()
	realNodeModules := path.Join(finalInstallDir, "node_modules")
	fakeNodeModules := path.Join(finalInstallDir, "fake_node_modules")
	nodePath := fmt.Sprintf("%s%c%s", realNodeModules, os.PathListSeparator, fakeNodeModules)
	
	env = append(env,
		fmt.Sprintf("NODE_PATH=%s", nodePath),
		"GRPC_TRACE=all",
		"GRPC_VERBOSITY=DEBUG",
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
