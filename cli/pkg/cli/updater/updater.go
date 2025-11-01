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
	"github.com/cline/cli/pkg/cli/output"
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

var verbose bool

// CheckAndUpdate performs a background update check and attempts to auto-update if needed.
// This is non-blocking and safe to call on CLI startup.
func CheckAndUpdate(isVerbose bool) {
	verbose = isVerbose

	// Skip in CI environments
	if os.Getenv("CI") != "" {
		if verbose {
			output.Printf("[updater] Skipping update check (CI environment)\n")
		}
		return
	}

	// Skip if user disabled auto-updates
	if os.Getenv("NO_AUTO_UPDATE") != "" {
		if verbose {
			output.Printf("[updater] Skipping update check (NO_AUTO_UPDATE set)\n")
		}
		return
	}

	if verbose {
		output.Printf("[updater] Starting background update check...\n")
	}

	// Run in background so we don't block CLI startup
	go func() {
		if err := checkAndUpdateInternal(false); err != nil {
			if verbose {
				output.Printf("[updater] Update check failed: %v\n", err)
			}
		}
	}()
}

// CheckAndUpdateSync performs a synchronous update check (blocks until complete).
// If bypassCache is true, ignores the 24-hour cache and always checks npm registry.
// This is used by the doctor command.
func CheckAndUpdateSync(isVerbose bool, bypassCache bool) {
	verbose = isVerbose

	// Skip in CI environments
	if os.Getenv("CI") != "" {
		if verbose {
			output.Printf("[updater] Skipping update check (CI environment)\n")
		}
		return
	}

	// Skip if user disabled auto-updates
	if os.Getenv("NO_AUTO_UPDATE") != "" {
		if verbose {
			output.Printf("[updater] Skipping update check (NO_AUTO_UPDATE set)\n")
		}
		return
	}

	if verbose {
		output.Printf("[updater] Starting update check...\n")
	}

	// Run synchronously
	if err := checkAndUpdateInternal(bypassCache); err != nil {
		if verbose {
			output.Printf("[updater] Update check failed: %v\n", err)
		}
	}
}

func checkAndUpdateInternal(bypassCache bool) error {
	if verbose {
		output.Printf("[updater] Loading update cache...\n")
	}

	// Load cache
	cache, err := loadCache()
	if !bypassCache && err == nil && time.Since(cache.LastCheck) < checkInterval {
		// Checked recently, skip (unless cache is bypassed)
		if verbose {
			output.Printf("[updater] Cache is fresh (last checked %v ago), skipping\n", time.Since(cache.LastCheck))
		}
		return nil
	}

	if err != nil && verbose {
		output.Printf("[updater] Cache load failed or doesn't exist: %v\n", err)
	}

	// Determine channel
	distTag := "latest"
	if strings.Contains(global.CliVersion, "nightly") {
		distTag = "nightly"
	}

	if verbose {
		output.Printf("[updater] Current version: %s (channel: %s)\n", global.CliVersion, distTag)
		output.Printf("[updater] Fetching latest version from npm registry...\n")
	}

	// Fetch latest version from npm
	latestVersion, err := fetchLatestVersion()
	if err != nil {
		if verbose {
			output.Printf("[updater] Failed to fetch latest version: %v\n", err)
		}
		return err
	}

	if verbose {
		output.Printf("[updater] Latest version on npm: %s\n", latestVersion)
	}

	// Update cache
	cache = cacheData{
		LastCheck:     time.Now(),
		LatestVersion: latestVersion,
	}
	saveCache(cache)

	if verbose {
		output.Printf("[updater] Updated cache\n")
	}

	// Compare versions
	currentVersion := strings.TrimPrefix(global.CliVersion, "v")
	latestVersion = strings.TrimPrefix(latestVersion, "v")

	if verbose {
		output.Printf("[updater] Comparing versions: current=%s latest=%s\n", currentVersion, latestVersion)
	}

	if !isNewer(latestVersion, currentVersion) {
		// Already up to date
		if verbose {
			output.Printf("[updater] Already on latest version, no update needed\n")
		}
		return nil
	}

	if verbose {
		output.Printf("[updater] Update available! Attempting to install...\n")
	}

	// Determine channel for update command
	channel := "latest"
	if strings.Contains(global.CliVersion, "nightly") {
		channel = "nightly"
	}

	// Attempt update
	if verbose {
		output.Printf("[updater] Running: npm install -g cline%s\n",
			map[bool]string{true: "@"+channel, false: ""}[channel == "nightly"])
	}

	if err := attemptUpdate(channel); err != nil {
		if verbose {
			output.Printf("[updater] Update failed: %v\n", err)
		}
		showFailureMessage(channel)
		return err
	}

	if verbose {
		output.Printf("[updater] Update completed successfully!\n")
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
	// Parse version strings (e.g., "1.0.0-nightly.19")
	latestBase, latestSuffix := parseVersion(latest)
	currentBase, currentSuffix := parseVersion(current)

	// Compare base versions (1.0.0)
	comparison := compareVersionParts(latestBase, currentBase)
	if comparison != 0 {
		return comparison > 0
	}

	// Base versions are equal, compare suffixes (nightly.19)
	return compareSuffix(latestSuffix, currentSuffix) > 0
}

func parseVersion(version string) (string, string) {
	parts := strings.SplitN(version, "-", 2)
	if len(parts) == 2 {
		return parts[0], parts[1]
	}
	return parts[0], ""
}

func compareVersionParts(v1, v2 string) int {
	parts1 := strings.Split(v1, ".")
	parts2 := strings.Split(v2, ".")

	for i := 0; i < len(parts1) && i < len(parts2); i++ {
		// Convert to int for proper numeric comparison
		n1 := parseInt(parts1[i])
		n2 := parseInt(parts2[i])

		if n1 > n2 {
			return 1
		}
		if n1 < n2 {
			return -1
		}
	}

	// If all parts are equal, longer version is newer
	if len(parts1) > len(parts2) {
		return 1
	}
	if len(parts1) < len(parts2) {
		return -1
	}
	return 0
}

func compareSuffix(s1, s2 string) int {
	// If one has no suffix, stable > prerelease
	if s1 == "" && s2 == "" {
		return 0
	}
	if s1 == "" {
		return 1 // Stable is newer than prerelease
	}
	if s2 == "" {
		return -1 // Prerelease is older than stable
	}

	// Both have suffixes (e.g., "nightly.19" vs "nightly.18")
	// Extract the numeric part after the last dot
	n1 := extractBuildNumber(s1)
	n2 := extractBuildNumber(s2)

	if n1 > n2 {
		return 1
	}
	if n1 < n2 {
		return -1
	}
	return 0
}

func extractBuildNumber(suffix string) int {
	// Extract number from "nightly.19" -> 19
	parts := strings.Split(suffix, ".")
	if len(parts) > 1 {
		return parseInt(parts[len(parts)-1])
	}
	return 0
}

func parseInt(s string) int {
	var result int
	fmt.Sscanf(s, "%d", &result)
	return result
}

func showSuccessMessage(version string) {
	output.Printf("\n%s Updated to %s %s Changes will take effect next session\n\n",
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

	output.Printf("\n%s Auto-update failed %s Try: %s\n\n",
		errorStyle.Render("✗"),
		dimStyle.Render("·"),
		"npm install -g "+packageName,
	)
}

func getCacheFilePath() string {
	configDir := filepath.Join(os.Getenv("HOME"), ".cline", "data")
	return filepath.Join(configDir, "cli-update-cache")
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