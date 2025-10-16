package updater

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/cline/cli/pkg/cli/global"
)

type cacheData struct {
	LastCheck     time.Time `json:"last_check"`
	LatestVersion string    `json:"latest_version"`
}

type npmRegistryResponse struct {
	DistTags struct {
		Latest  string `json:"latest"`
		Nightly string `json:"nightly"`
	} `json:"dist-tags"`
}

const (
	checkInterval = 24 * time.Hour
	requestTimeout = 3 * time.Second
)

var (
	successStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("2")).Bold(true)
	errorStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("1")).Bold(true)
	dimStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
)

// CheckAndUpdate performs a background update check and attempts to auto-update if needed.
// This is non-blocking and safe to call on CLI startup.
func CheckAndUpdate() {
	// Skip in CI environments
	if os.Getenv("CI") != "" {
		return
	}

	// Skip if user disabled auto-updates
	if os.Getenv("NO_AUTO_UPDATE") != "" {
		return
	}

	// Run in background so we don't block CLI startup
	go func() {
		if err := checkAndUpdateSync(); err != nil {
			// Silently ignore errors during check phase
			// Only show errors if we actually attempted an update
		}
	}()
}

func checkAndUpdateSync() error {
	// Load cache
	cache, err := loadCache()
	if err == nil && time.Since(cache.LastCheck) < checkInterval {
		// Checked recently, skip
		return nil
	}

	// Fetch latest version from npm
	latestVersion, err := fetchLatestVersion()
	if err != nil {
		return err
	}

	// Update cache
	cache = cacheData{
		LastCheck:     time.Now(),
		LatestVersion: latestVersion,
	}
	saveCache(cache)

	// Compare versions
	currentVersion := strings.TrimPrefix(global.CliVersion, "v")
	latestVersion = strings.TrimPrefix(latestVersion, "v")

	if !isNewer(latestVersion, currentVersion) {
		// Already up to date
		return nil
	}

	// Determine channel for update command
	channel := "latest"
	if strings.Contains(global.CliVersion, "nightly") {
		channel = "nightly"
	}

	// Attempt update
	if err := attemptUpdate(channel); err != nil {
		showFailureMessage(channel)
		return err
	}

	showSuccessMessage(latestVersion)
	return nil
}

func fetchLatestVersion() (string, error) {
	// Determine dist-tag from current version
	distTag := "latest"
	if strings.Contains(global.CliVersion, "nightly") {
		distTag = "nightly"
	}

	ctx, cancel := context.WithTimeout(context.Background(), requestTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", "https://registry.npmjs.org/cline", nil)
	if err != nil {
		return "", err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("npm registry returned status %d", resp.StatusCode)
	}

	var data npmRegistryResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", err
	}

	if distTag == "nightly" {
		return data.DistTags.Nightly, nil
	}
	return data.DistTags.Latest, nil
}

func attemptUpdate(channel string) error {
	packageName := "cline"
	if channel == "nightly" {
		packageName = "cline@nightly"
	}

	cmd := exec.Command("npm", "install", "-g", packageName)
	cmd.Stdout = nil
	cmd.Stderr = nil

	return cmd.Run()
}

func isNewer(latest, current string) bool {
	// Simple version comparison
	// Remove any -nightly or other suffixes for comparison
	latest = strings.Split(latest, "-")[0]
	current = strings.Split(current, "-")[0]

	latestParts := strings.Split(latest, ".")
	currentParts := strings.Split(current, ".")

	// Compare major, minor, patch
	for i := 0; i < len(latestParts) && i < len(currentParts); i++ {
		if latestParts[i] > currentParts[i] {
			return true
		}
		if latestParts[i] < currentParts[i] {
			return false
		}
	}

	return len(latestParts) > len(currentParts)
}

func showSuccessMessage(version string) {
	fmt.Fprintf(os.Stderr, "\n%s Updated to %s %s Changes will take effect next session\n\n",
		successStyle.Render("✓"),
		successStyle.Render("v"+version),
		dimStyle.Render("→"),
	)
}

func showFailureMessage(channel string) {
	packageName := "cline"
	if channel == "nightly" {
		packageName = "cline@nightly"
	}

	fmt.Fprintf(os.Stderr, "\n%s Auto-update failed %s Try: %s\n\n",
		errorStyle.Render("✗"),
		dimStyle.Render("·"),
		"npm install -g "+packageName,
	)
}

func getCacheFilePath() string {
	configDir := filepath.Join(os.Getenv("HOME"), ".cline")
	return filepath.Join(configDir, ".update-cache")
}

func loadCache() (cacheData, error) {
	var cache cacheData
	cacheFile := getCacheFilePath()

	data, err := os.ReadFile(cacheFile)
	if err != nil {
		return cache, err
	}

	err = json.Unmarshal(data, &cache)
	return cache, err
}

func saveCache(cache cacheData) error {
	cacheFile := getCacheFilePath()

	// Ensure config directory exists
	configDir := filepath.Dir(cacheFile)
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return err
	}

	data, err := json.Marshal(cache)
	if err != nil {
		return err
	}

	return os.WriteFile(cacheFile, data, 0644)
}
