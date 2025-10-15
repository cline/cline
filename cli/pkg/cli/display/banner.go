package display

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// BannerInfo contains information to display in the session banner
type BannerInfo struct {
	Version    string
	Provider   string
	ModelID    string
	Workdir    string
	Mode       string
}

// RenderSessionBanner renders a nice banner showing version, model, and workspace info
func RenderSessionBanner(info BannerInfo) string {
	// Bright white for title
	titleStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("15")). // Bright white
		Bold(true)

	// Dim gray for regular text (same as huh placeholder)
	dimStyle := lipgloss.NewStyle().
		Foreground(lipgloss.AdaptiveColor{Light: "248", Dark: "238"})

	// Border color matches mode
	borderColor := lipgloss.Color("3") // Yellow for plan
	if info.Mode == "act" {
		borderColor = lipgloss.Color("39") // Blue for act
	}

	boxStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(borderColor).
		Padding(1, 4)

	var lines []string

	// Format version with "v" prefix if it starts with a number
	versionStr := info.Version
	if len(versionStr) > 0 && versionStr[0] >= '0' && versionStr[0] <= '9' {
		versionStr = "v" + versionStr
	}

	// First line: "cline cli vX.X.X" on left, "plan mode" on right
	leftSide := titleStyle.Render("cline cli preview") + " " + dimStyle.Render(versionStr)

	if info.Mode != "" {
		modeColor := lipgloss.Color("3") // Yellow for plan
		if info.Mode == "act" {
			modeColor = lipgloss.Color("39") // Blue for act
		}
		modeStyle := lipgloss.NewStyle().Foreground(modeColor).Bold(true)
		rightSide := modeStyle.Render(info.Mode + " mode")

		// Calculate spacing to push mode to the right
		// Assume a reasonable width (we'll adjust based on content)
		lineWidth := 50
		leftWidth := lipgloss.Width(leftSide)
		rightWidth := lipgloss.Width(rightSide)
		spacing := lineWidth - leftWidth - rightWidth

		if spacing > 0 {
			titleLine := leftSide + strings.Repeat(" ", spacing) + rightSide
			lines = append(lines, titleLine)
		} else {
			// If too narrow, just put them on same line with a space
			lines = append(lines, leftSide+" "+rightSide)
		}
	} else {
		// No mode, just show title
		lines = append(lines, leftSide)
	}

	// Model line - dim gray
	if info.Provider != "" && info.ModelID != "" {
		lines = append(lines, dimStyle.Render(info.Provider+"/"+shortenPath(info.ModelID, 30)))
	}

	// Workspace line - dim gray
	if info.Workdir != "" {
		lines = append(lines, dimStyle.Render(shortenPath(info.Workdir, 45)))
	}

	content := lipgloss.JoinVertical(lipgloss.Left, lines...)
	return boxStyle.Render(content)
}

// shortenPath shortens a filesystem path to fit within maxLen
func shortenPath(path string, maxLen int) string {
	// Try to replace home directory with ~ (cross-platform)
	if homeDir, err := os.UserHomeDir(); err == nil {
		if strings.HasPrefix(path, homeDir) {
			shortened := "~" + path[len(homeDir):]
			// Always use ~ version if we can
			path = shortened
		}
	}

	if len(path) <= maxLen {
		return path
	}

	// If still too long, show last few path components
	if len(path) > maxLen {
		parts := strings.Split(path, string(filepath.Separator))
		if len(parts) > 2 {
			// Show last 2-3 components
			lastParts := parts[len(parts)-2:]
			shortened := "..." + string(filepath.Separator) + strings.Join(lastParts, string(filepath.Separator))
			if len(shortened) <= maxLen {
				return shortened
			}
		}
	}

	// Last resort: truncate with ellipsis
	if len(path) > maxLen {
		return "..." + path[len(path)-maxLen+3:]
	}

	return path
}

// ExtractBannerInfoFromState extracts banner info from state JSON
func ExtractBannerInfoFromState(stateJSON, version string) (BannerInfo, error) {
	var state map[string]interface{}
	if err := json.Unmarshal([]byte(stateJSON), &state); err != nil {
		return BannerInfo{}, fmt.Errorf("failed to parse state JSON: %w", err)
	}

	info := BannerInfo{
		Version: version,
	}

	// Extract mode
	if mode, ok := state["mode"].(string); ok {
		info.Mode = mode
	}

	// Extract workspace roots
	if workspaceRoots, ok := state["workspaceRoots"].([]interface{}); ok && len(workspaceRoots) > 0 {
		if root, ok := workspaceRoots[0].(map[string]interface{}); ok {
			if path, ok := root["path"].(string); ok {
				info.Workdir = path
			}
		}
	}

	// Extract API configuration to get provider/model
	if apiConfig, ok := state["apiConfiguration"].(map[string]interface{}); ok {
		// Try common keys for provider and model (both camelCase and lowercase variants)
		providerKeys := []string{"apiProvider", "api_provider"}
		modelKeys := []string{"apiModelId", "api_model_id"}

		// Try to extract provider
		for _, key := range providerKeys {
			if provider, ok := apiConfig[key].(string); ok && provider != "" {
				info.Provider = provider
				break
			}
		}

		// Try to extract model ID
		for _, key := range modelKeys {
			if modelID, ok := apiConfig[key].(string); ok && modelID != "" {
				info.ModelID = shortenModelID(modelID)
				break
			}
		}
	}

	return info, nil
}

// shortenModelID shortens long model IDs for display
func shortenModelID(modelID string) string {
	// Remove date suffixes only if they're at the end (e.g., -20241022)
	// Check if the model ID ends with -YYYYMMDD pattern
	if len(modelID) > 9 {
		suffix := modelID[len(modelID)-9:] // Last 9 chars: -20241022
		if suffix[0] == '-' &&
		   (strings.HasPrefix(suffix[1:], "202") || strings.HasPrefix(suffix[1:], "201")) {
			// Verify all remaining chars are digits
			allDigits := true
			for _, c := range suffix[1:] {
				if c < '0' || c > '9' {
					allDigits = false
					break
				}
			}
			if allDigits {
				return modelID[:len(modelID)-9]
			}
		}
	}

	// If still too long, show first 40 chars
	if len(modelID) > 40 {
		return modelID[:37] + "..."
	}

	return modelID
}
