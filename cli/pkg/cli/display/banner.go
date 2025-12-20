package display

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/cline/cli/pkg/common"
)

// BannerInfo contains information to display in the session banner
type BannerInfo struct {
	Version  string
	Provider string
	ModelID  string
	Workdirs []string // workspace directories
	Mode     string
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
		lines = append(lines, dimStyle.Render(info.Provider+"/"+common.ShortenPath(info.ModelID, 30)))
	}

	for _, wd := range info.Workdirs {
		lines = append(lines, dimStyle.Render(common.ShortenPath(wd, 45)))
	}

	// Checkpoint warning for multi-root workspaces
	if len(info.Workdirs) > 1 {
		warningStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("3")). // Yellow warning color
			Italic(true)
		lines = append(lines, "")
		lines = append(lines, warningStyle.Render("⚠ Checkpoints disabled for multi-root workspaces"))
	}

	content := lipgloss.JoinVertical(lipgloss.Left, lines...)
	return boxStyle.Render(content)
}
