package global

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"time"

	"github.com/cline/cli/pkg/common"
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

	fmt.Printf("Starting new Cline instance on ports %d (core) and %d (host bridge)\n", corePort, hostPort)

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
	fmt.Println("Waiting for services to start and self-register in SQLite...")

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

	fmt.Println("Services started and registered successfully!")
	fmt.Printf("  Address: %s\n", instance.Address)
	fmt.Printf("  Core Port: %d\n", instance.CorePort())
	fmt.Printf("  Host Bridge Port: %d\n", instance.HostPort())
	fmt.Printf("  Process PID: %d\n", coreCmd.Process.Pid)
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

	fmt.Printf("Starting new Cline instance on ports %d (core) and %d (host bridge)\n", corePort, hostPort)

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
	fmt.Println("Waiting for services to start and self-register in SQLite...")

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

	fmt.Println("Services started and registered successfully!")
	fmt.Printf("  Address: %s\n", instance.Address)
	fmt.Printf("  Core Port: %d\n", instance.CorePort())
	fmt.Printf("  Host Bridge Port: %d\n", instance.HostPort())
	fmt.Printf("  Process PID: %d\n", coreCmd.Process.Pid)
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
	fmt.Printf("Starting cline-host on port %d\n", hostPort)

	// Start the cline-host process
	cmd := exec.Command("./cli/bin/cline-host",
		"--verbose",
		"--port", fmt.Sprintf("%d", hostPort))

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start cline-host: %w", err)
	}

	fmt.Printf("Started cline-host (PID: %d)\n", cmd.Process.Pid)
	return cmd, nil
}

func startClineCore(corePort, hostPort int) (*exec.Cmd, error) {
	fmt.Printf("Starting cline-core on port %d (with hostbridge on %d)\n", corePort, hostPort)

	// Create port-tagged log file in OS temp directory with full address
	logFileName := fmt.Sprintf("cline-core-debug-localhost-%d.log", corePort)
	logFilePath := fmt.Sprintf("%s/%s", os.TempDir(), logFileName)
	logFile, err := os.Create(logFilePath)
	if err != nil {
		return nil, fmt.Errorf("failed to create log file: %w", err)
	}

	// Start the cline-core process with --config flag instead of CLINE_DIR env var
	args := []string{"cline-core.js",
		"--port", fmt.Sprintf("%d", corePort),
		"--host-bridge-port", fmt.Sprintf("%d", hostPort),
		"--config", Config.ConfigPath}

	fmt.Printf("DEBUG: Starting cline-core with command: node %v\n", args)
	fmt.Printf("DEBUG: Working directory: ./dist-standalone\n")
	fmt.Printf("DEBUG: Config path: %s\n", Config.ConfigPath)

	cmd := exec.Command("node", args...)

	// Set working directory to dist-standalone (relative to project root)
	cmd.Dir = "./dist-standalone"

	// Redirect stdout and stderr to log file
	cmd.Stdout = logFile
	cmd.Stderr = logFile

	// Set environment variables (removed CLINE_DIR)
	env := os.Environ()
	env = append(env,
		"GRPC_TRACE=all",
		"GRPC_VERBOSITY=DEBUG",
		"NODE_ENV=development",
	)
	cmd.Env = env

	if err := cmd.Start(); err != nil {
		logFile.Close()
		return nil, fmt.Errorf("failed to start cline-core: %w", err)
	}

	fmt.Printf("Started cline-core (PID: %d)\n", cmd.Process.Pid)
	fmt.Printf("Logging cline-core output to: %s\n", logFilePath)
	return cmd, nil
}
