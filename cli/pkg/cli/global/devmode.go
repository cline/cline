package global

import (
	"os"
	"path/filepath"
)

// DevMode detection and configuration

// IsDevMode determines if the CLI is running in development mode.
// Development mode is detected when any of the following conditions are true:
// 1. CLINE_DEV_MODE environment variable is set to "1" or "true"
// 2. A .git directory exists in the project root (2 levels up from binary)
// 3. A .cline-dev marker file exists in the project root
//
// This allows developers to work without packaging while ensuring
// production installations work correctly.
func IsDevMode() bool {
	// Check explicit environment variable first (highest priority)
	if devMode := os.Getenv("CLINE_DEV_MODE"); devMode == "1" || devMode == "true" {
		return true
	}

	// Get the binary's location
	execPath, err := os.Executable()
	if err != nil {
		return false
	}

	// Resolve any symlinks
	execPath, err = filepath.EvalSymlinks(execPath)
	if err != nil {
		return false
	}

	// Get project root (2 levels up: bin/cline -> cli -> project-root)
	binDir := filepath.Dir(execPath)
	cliDir := filepath.Dir(binDir)
	projectRoot := filepath.Dir(cliDir)

	// Check for .git directory (common in development)
	gitDir := filepath.Join(projectRoot, ".git")
	if stat, err := os.Stat(gitDir); err == nil && stat.IsDir() {
		return true
	}

	// Check for explicit dev marker file
	devMarker := filepath.Join(projectRoot, ".cline-dev")
	if _, err := os.Stat(devMarker); err == nil {
		return true
	}

	return false
}

// GetProjectRoot returns the project root directory based on the binary location.
// For development: returns the Git repository root
// For production: returns the installation directory
func GetProjectRoot() (string, error) {
	execPath, err := os.Executable()
	if err != nil {
		return "", err
	}

	// Resolve symlinks
	execPath, err = filepath.EvalSymlinks(execPath)
	if err != nil {
		return "", err
	}

	binDir := filepath.Dir(execPath)
	installDir := filepath.Dir(binDir)

	if IsDevMode() {
		// In dev mode, go up one more level to project root
		return filepath.Dir(installDir), nil
	}

	return installDir, nil
}
