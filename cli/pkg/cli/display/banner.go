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
	// Color palette
	subtle := lipgloss.AdaptiveColor{Light: "#D9DCCF", Dark: "#383838"}
	highlight := lipgloss.AdaptiveColor{Light: "#874BFD", Dark: "#7D56F4"}
	label := lipgloss.AdaptiveColor{Light: "#666666", Dark: "#999999"}

	// Styles
	labelStyle := lipgloss.NewStyle().
		Foreground(label).
		Bold(true)

	valueStyle := lipgloss.NewStyle().
		Foreground(highlight)

	pathStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("6")). // Cyan for paths
		Italic(true)

	boxStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(subtle).
		Padding(0, 1)

	// Build the banner content
	var lines []string

	// Version line
	versionLine := lipgloss.JoinHorizontal(
		lipgloss.Left,
		labelStyle.Render("cline cli"),
		" ",
		valueStyle.Render(info.Version),
	)
	lines = append(lines, versionLine)

	// Mode line
	if info.Mode != "" {
		modeColor := lipgloss.Color("3") // Yellow for plan
		if info.Mode == "act" {
			modeColor = lipgloss.Color("39") // Blue for act
		}
		modeStyle := lipgloss.NewStyle().Foreground(modeColor).Bold(true)

		modeLine := lipgloss.JoinHorizontal(
			lipgloss.Left,
			labelStyle.Render("mode"),
			"      ",
			modeStyle.Render(info.Mode),
		)
		lines = append(lines, modeLine)
	}

	// Model line (provider/model)
	if info.Provider != "" && info.ModelID != "" {
		modelLine := lipgloss.JoinHorizontal(
			lipgloss.Left,
			labelStyle.Render("model"),
			"     ",
			valueStyle.Render(info.Provider+"/"+info.ModelID),
		)
		lines = append(lines, modelLine)
	}

	// Workspace line (shortened path)
	if info.Workdir != "" {
		// Shorten the path for readability
		shortened := shortenPath(info.Workdir, 50)
		workdirLine := lipgloss.JoinHorizontal(
			lipgloss.Left,
			labelStyle.Render("workspace"),
			" ",
			pathStyle.Render(shortened),
		)
		lines = append(lines, workdirLine)
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
