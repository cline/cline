package services

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

const (
	CLINE_CORE_PORT = 51051
	CLINE_HOST_PORT = 51052
)

// ServiceManager handles starting and checking Cline services
type ServiceManager struct {
	installDir string
	nodeBin    string
	clineCore  string
	clineHost  string
}

// NewServiceManager creates a new service manager
func NewServiceManager() (*ServiceManager, error) {
	// Get the directory where the cline binary is located
	execPath, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("failed to get executable path: %w", err)
	}

	binDir := filepath.Dir(execPath)
	installDir := filepath.Dir(binDir)

	return &ServiceManager{
		installDir: installDir,
		nodeBin:    filepath.Join(binDir, "node"),
		clineCore:  filepath.Join(installDir, "cline-core.js"),
		clineHost:  filepath.Join(binDir, "cline-host"),
	}, nil
}

// EnsureServicesRunning ensures both cline-host and cline-core are running
func (sm *ServiceManager) EnsureServicesRunning() error {
	// Start cline-host if not running
	if !sm.isProcessRunning("cline-host") {
		if err := sm.startClineHost(); err != nil {
			return fmt.Errorf("failed to start cline-host: %w", err)
		}
		time.Sleep(1 * time.Second)
	}

	// Start cline-core if not running
	if !sm.isProcessRunning("cline-core") {
		if err := sm.startClineCore(); err != nil {
			return fmt.Errorf("failed to start cline-core: %w", err)
		}
		time.Sleep(2 * time.Second)
	}

	return nil
}

// isProcessRunning checks if a process with the given name is running
func (sm *ServiceManager) isProcessRunning(name string) bool {
	var cmd *exec.Cmd

	switch runtime.GOOS {
	case "windows":
		// Windows: use tasklist
		cmd = exec.Command("tasklist", "/FI", fmt.Sprintf("IMAGENAME eq %s*", name))
	case "darwin", "linux":
		// macOS/Linux: use pgrep
		cmd = exec.Command("pgrep", "-f", name)
	default:
		return false
	}

	output, err := cmd.Output()
	if err != nil {
		return false
	}

	return len(output) > 0
}

// startClineHost starts the cline-host process in the background
func (sm *ServiceManager) startClineHost() error {
	if _, err := os.Stat(sm.clineHost); os.IsNotExist(err) {
		return fmt.Errorf("cline-host binary not found at %s", sm.clineHost)
	}

	cmd := exec.Command(sm.clineHost, "--port", fmt.Sprintf("%d", CLINE_HOST_PORT))
	
	// Detach the process so it runs in the background
	cmd.Stdout = nil
	cmd.Stderr = nil
	cmd.Stdin = nil

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start cline-host: %w", err)
	}

	// Don't wait for the process - let it run in background
	go cmd.Wait()

	return nil
}

// startClineCore starts the cline-core Node.js process in the background
func (sm *ServiceManager) startClineCore() error {
	if _, err := os.Stat(sm.nodeBin); os.IsNotExist(err) {
		return fmt.Errorf("node binary not found at %s", sm.nodeBin)
	}

	if _, err := os.Stat(sm.clineCore); os.IsNotExist(err) {
		return fmt.Errorf("cline-core.js not found at %s", sm.clineCore)
	}

	cmd := exec.Command(
		sm.nodeBin,
		sm.clineCore,
		"--port", fmt.Sprintf("%d", CLINE_CORE_PORT),
		"--host-bridge-port", fmt.Sprintf("%d", CLINE_HOST_PORT),
	)

	// Set environment variables
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("CLINE_CORE_PATH=%s", sm.installDir),
		fmt.Sprintf("NODE_PATH=%s", filepath.Join(sm.installDir, "node_modules")),
	)

	// Detach the process so it runs in the background
	cmd.Stdout = nil
	cmd.Stderr = nil
	cmd.Stdin = nil

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start cline-core: %w", err)
	}

	// Don't wait for the process - let it run in background
	go cmd.Wait()

	return nil
}
