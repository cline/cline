package output

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/cline/cli/pkg/cli/slash"
)

const maxVisibleCompletions = 7

// completionStyles holds the styling for the completion dropdown
type completionStyles struct {
	menu            lipgloss.Style
	selected        lipgloss.Style
	normalName      lipgloss.Style
	description     lipgloss.Style
	scrollIndicator lipgloss.Style
}

// newCompletionStyles creates the default styles for the completion dropdown
func newCompletionStyles() completionStyles {
	return completionStyles{
		menu: lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("238")).
			Padding(0, 1),
		selected: lipgloss.NewStyle().
			Background(lipgloss.Color("62")).
			Foreground(lipgloss.Color("230")),
		normalName: lipgloss.NewStyle().
			Foreground(lipgloss.AdaptiveColor{Light: "235", Dark: "252"}),
		description: lipgloss.NewStyle().
			Foreground(lipgloss.Color("243")),
		scrollIndicator: lipgloss.NewStyle().
			Foreground(lipgloss.Color("243")),
	}
}

// CompletionModel is a Bubbletea model for slash command autocomplete dropdown
type CompletionModel struct {
	registry *slash.Registry
	visible  bool
	matches  []slash.Command
	index    int // selected item (0-based)
	scroll   int // scroll offset for long lists
	styles   completionStyles

	// pendingApply holds the command to apply after selection
	pendingApply string
}

// NewCompletionModel creates a new completion model with the given registry
func NewCompletionModel(registry *slash.Registry) CompletionModel {
	return CompletionModel{
		registry: registry,
		styles:   newCompletionStyles(),
	}
}

// SetRegistry sets the slash command registry
func (m *CompletionModel) SetRegistry(registry *slash.Registry) {
	m.registry = registry
}

// Visible returns whether the completion dropdown is currently visible
func (m CompletionModel) Visible() bool {
	return m.visible
}

// Update handles key messages for the completion dropdown.
// Returns the updated model, any commands, and whether the key was handled.
// If handled is true, the parent should NOT pass the key to the textarea.
func (m CompletionModel) Update(msg tea.Msg) (CompletionModel, tea.Cmd, bool) {
	if !m.visible {
		return m, nil, false
	}

	keyMsg, ok := msg.(tea.KeyMsg)
	if !ok {
		return m, nil, false
	}

	switch keyMsg.String() {
	case "up":
		m.navigateUp()
		return m, nil, true

	case "down":
		m.navigateDown()
		return m, nil, true

	case "tab", "enter":
		// Select the current completion
		if len(m.matches) > 0 {
			selected := m.matches[m.index]
			m.pendingApply = "/" + selected.Name + " "
		}
		m.Hide()
		return m, nil, true

	case "esc":
		m.Hide()
		return m, nil, true
	}

	// Key not handled by completion - let parent process it
	return m, nil, false
}

// CheckInput updates the completion state based on the current input value.
// Call this after each input change to show/hide/update the dropdown.
func (m *CompletionModel) CheckInput(value string) {
	if m.registry == nil {
		return
	}

	// Only activate if input starts with "/" (first character requirement)
	if !strings.HasPrefix(value, "/") {
		m.Hide()
		return
	}

	// Extract the command being typed (everything after "/" until space/newline)
	rest := value[1:] // Everything after the "/"

	// If there's whitespace, the command is complete - hide dropdown
	if idx := strings.IndexAny(rest, " \n\t"); idx != -1 {
		m.Hide()
		return
	}

	// Update matches based on prefix
	m.updateMatches(rest)
	m.visible = len(m.matches) > 0
}

// Apply returns the command string to insert (if any) and clears the pending state.
// The parent should call this after Update returns handled=true for tab/enter.
func (m *CompletionModel) Apply() string {
	result := m.pendingApply
	m.pendingApply = ""
	return result
}

// Hide hides the completion dropdown and resets state
func (m *CompletionModel) Hide() {
	m.visible = false
	m.matches = nil
	m.index = 0
	m.scroll = 0
}

// View renders the completion dropdown
func (m CompletionModel) View() string {
	if !m.visible || len(m.matches) == 0 {
		return ""
	}

	var lines []string

	// Calculate visible range
	endIdx := min(m.scroll+maxVisibleCompletions, len(m.matches))

	// Show scroll indicator if there are items above
	if m.scroll > 0 {
		lines = append(lines, m.styles.scrollIndicator.Render("  ↑ more"))
	}

	// Find the longest command name for alignment
	maxNameLen := 0
	for _, cmd := range m.matches {
		nameLen := len(cmd.Name) + 1 // +1 for the "/"
		if nameLen > maxNameLen {
			maxNameLen = nameLen
		}
	}
	// Cap at reasonable width
	if maxNameLen > 15 {
		maxNameLen = 15
	}

	// Render visible items
	for i := m.scroll; i < endIdx; i++ {
		cmd := m.matches[i]
		name := "/" + cmd.Name
		desc := cmd.Description

		// Truncate description if too long
		maxDescLen := 35
		if len(desc) > maxDescLen {
			desc = desc[:maxDescLen-3] + "..."
		}

		// Pad name for alignment
		paddedName := fmt.Sprintf("%-*s", maxNameLen, name)

		if i == m.index {
			// Selected item - highlight the entire line
			line := fmt.Sprintf("> %s  %s", paddedName, desc)
			lines = append(lines, m.styles.selected.Render(line))
		} else {
			// Normal item
			line := fmt.Sprintf("  %s  %s", m.styles.normalName.Render(paddedName), m.styles.description.Render(desc))
			lines = append(lines, line)
		}
	}

	// Show scroll indicator if there are items below
	if endIdx < len(m.matches) {
		lines = append(lines, m.styles.scrollIndicator.Render("  ↓ more"))
	}

	return m.styles.menu.Render(strings.Join(lines, "\n"))
}

// updateMatches filters commands by prefix and updates the matches list
func (m *CompletionModel) updateMatches(prefix string) {
	if m.registry == nil {
		m.matches = nil
		return
	}
	m.matches = m.registry.GetMatching(prefix)
	// Reset selection if out of bounds
	if m.index >= len(m.matches) {
		m.index = 0
		m.scroll = 0
	}
	m.adjustScroll()
}

// navigateUp moves selection up in the dropdown
func (m *CompletionModel) navigateUp() {
	if len(m.matches) == 0 {
		return
	}
	m.index--
	if m.index < 0 {
		m.index = len(m.matches) - 1
	}
	m.adjustScroll()
}

// navigateDown moves selection down in the dropdown
func (m *CompletionModel) navigateDown() {
	if len(m.matches) == 0 {
		return
	}
	m.index++
	if m.index >= len(m.matches) {
		m.index = 0
	}
	m.adjustScroll()
}

// adjustScroll ensures the selected item is visible in the dropdown
func (m *CompletionModel) adjustScroll() {
	if m.index < m.scroll {
		m.scroll = m.index
	} else if m.index >= m.scroll+maxVisibleCompletions {
		m.scroll = m.index - maxVisibleCompletions + 1
	}
}
