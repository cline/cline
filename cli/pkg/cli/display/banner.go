package display

import (
	"encoding/json"
	"fmt"
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

	// Title line - "cline cli" bold white, version dim gray
	lines = append(lines, titleStyle.Render("cline cli")+" "+dimStyle.Render(versionStr))

	// Mode line - colored based on mode
	if info.Mode != "" {
		modeColor := lipgloss.Color("3") // Yellow for plan
		if info.Mode == "act" {
			modeColor = lipgloss.Color("39") // Blue for act
		}
		modeStyle := lipgloss.NewStyle().Foreground(modeColor).Bold(true)
		lines = append(lines, modeStyle.Render(info.Mode+" mode"))
	}

	// Model line - dim gray
	if info.Provider != "" && info.ModelID != "" {
		lines = append(lines, dimStyle.Render(info.Provider+"/"+info.ModelID))
	}

	// Workspace line - dim gray
	if info.Workdir != "" {
		lines = append(lines, dimStyle.Render(shortenPath(info.Workdir, 50)))
	}

	content := lipgloss.JoinVertical(lipgloss.Left, lines...)
	return boxStyle.Render(content)
}

// shortenPath shortens a filesystem path to fit within maxLen
func shortenPath(path string, maxLen int) string {
	if len(path) <= maxLen {
		return path
	}

	// Try to show ~/... if it's in home directory
	if strings.HasPrefix(path, "/Users/") || strings.HasPrefix(path, "/home/") {
		parts := strings.Split(path, "/")
		if len(parts) > 2 {
			shortened := "~/" + strings.Join(parts[3:], "/")
			if len(shortened) <= maxLen {
				return shortened
			}
		}
	}

	// Otherwise show .../{last few components}
	parts := strings.Split(path, "/")
	if len(parts) > 2 {
		// Show last 2-3 components
		lastParts := parts[len(parts)-2:]
		shortened := ".../" + strings.Join(lastParts, "/")
		if len(shortened) <= maxLen {
			return shortened
		}
	}

	// Last resort: truncate with ellipsis
	return "..." + path[len(path)-maxLen+3:]
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
	// Remove date suffixes (e.g., -20241022)
	if idx := strings.LastIndex(modelID, "-202"); idx > 0 {
		return modelID[:idx]
	}
	if idx := strings.LastIndex(modelID, "-201"); idx > 0 {
		return modelID[:idx]
	}

	// If still too long, show first 40 chars
	if len(modelID) > 40 {
		return modelID[:37] + "..."
	}

	return modelID
}
