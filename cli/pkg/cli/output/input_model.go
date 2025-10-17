package output

import (
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/charmbracelet/bubbles/textarea"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// InputType represents the type of input being collected
type InputType int

const INPUT_WIDTH = 46 

const (
	InputTypeMessage InputType = iota
	InputTypeApproval
	InputTypeFeedback
)

// InputSubmitMsg is sent when the user submits input
type InputSubmitMsg struct {
	Value          string
	InputType      InputType
	Approved       bool // For approval type
	NeedsFeedback  bool // For approval type
	NoAskAgain     bool // For approval type - indicates "don't ask again" was selected
}

// InputCancelMsg is sent when the user cancels input (Ctrl+C)
type InputCancelMsg struct{}

// ChangeInputTypeMsg changes the current input type
type ChangeInputTypeMsg struct {
	InputType InputType
	Title     string
	Placeholder string
}

// editorFinishedMsg is sent when the external editor finishes
type editorFinishedMsg struct {
	content []byte
	err     error
}

// InputModel is the bubbletea model for interactive input
type InputModel struct {
	textarea    textarea.Model
	suspended   bool
	savedValue  string
	inputType   InputType
	title       string
	placeholder string
	currentMode string // "plan" or "act"
	width       int
	lastHeight  int    // Track height for cleanup on submit

	// For approval type
	approvalOptions []string
	selectedOption  int
	pendingApproval bool // Stores approval decision when transitioning to feedback input

	// Styles (huh-inspired theme)
	styles fieldStyles
}

// fieldStyles holds the styling for the input field
type fieldStyles struct {
	base           lipgloss.Style
	title          lipgloss.Style
	textArea       lipgloss.Style
	cursor         lipgloss.Style
	placeholder    lipgloss.Style
	selector       lipgloss.Style
	selectedOption lipgloss.Style
	option         lipgloss.Style
}

// newFieldStyles creates huh-inspired styles (Charm theme)
func newFieldStyles() fieldStyles {
	// Charm theme colors
	indigo := lipgloss.AdaptiveColor{Light: "#5A56E0", Dark: "#7571F9"}
	fuchsia := lipgloss.Color("#F780E2")
	normalFg := lipgloss.AdaptiveColor{Light: "235", Dark: "252"}
	green := lipgloss.AdaptiveColor{Light: "#02BA84", Dark: "#02BF87"}

	return fieldStyles{
		base: lipgloss.NewStyle().
			PaddingLeft(1).
			BorderStyle(lipgloss.ThickBorder()).
			BorderLeft(true).
			BorderForeground(lipgloss.Color("238")),
		title: lipgloss.NewStyle().
			Foreground(indigo).
			Bold(true),
		textArea: lipgloss.NewStyle().
			Foreground(normalFg),
		cursor: lipgloss.NewStyle().
			Foreground(green),
		placeholder: lipgloss.NewStyle().
			Foreground(lipgloss.AdaptiveColor{Light: "248", Dark: "238"}),
		selector: lipgloss.NewStyle().
			Foreground(fuchsia).
			SetString("> "),
		selectedOption: lipgloss.NewStyle().
			Foreground(normalFg),
		option: lipgloss.NewStyle().
			Foreground(normalFg),
	}
}

// NewInputModel creates a new input model
func NewInputModel(inputType InputType, title, placeholder, currentMode string) InputModel {
	ta := textarea.New()
	ta.Placeholder = placeholder
	ta.Focus()
	ta.CharLimit = 0
	ta.ShowLineNumbers = false
	ta.Prompt = ""  // Remove prompt prefix (this is what adds the inner border!)
	ta.SetHeight(5)
	// Don't set width here - let WindowSizeMsg handle it
	ta.SetWidth(INPUT_WIDTH)

	// Configure keybindings like huh does:
	// alt+enter and ctrl+j for newlines (textarea will handle these)
	ta.KeyMap.InsertNewline.SetKeys("alt+enter", "ctrl+j")

	// Apply huh-like styling
	styles := newFieldStyles()

	// Set cursor color based on mode
	cursorColor := lipgloss.Color("3") // Yellow for plan
	if currentMode == "act" {
		cursorColor = lipgloss.Color("39") // Blue for act
	}

	ta.FocusedStyle.CursorLine = lipgloss.NewStyle()   // No cursor line highlighting
	ta.FocusedStyle.EndOfBuffer = lipgloss.NewStyle()  // No end-of-buffer styling
	ta.FocusedStyle.Placeholder = styles.placeholder
	ta.FocusedStyle.Text = styles.textArea
	ta.FocusedStyle.Prompt = lipgloss.NewStyle()       // No prompt styling
	ta.Cursor.Style = lipgloss.NewStyle().Foreground(cursorColor)
	ta.Cursor.TextStyle = styles.textArea

	m := InputModel{
		textarea:    ta,
		inputType:   inputType,
		title:       title,
		placeholder: placeholder,
		currentMode: currentMode,
		width:       0, // Will be set by first WindowSizeMsg
		styles:      styles,
	}

	// For approval type, set up options
	if inputType == InputTypeApproval {
		m.approvalOptions = []string{
			"Yes",
			"Yes, and don't ask again for this task",
			"No, with feedback",
		}
		m.selectedOption = 0
	}

	return m
}

// Init initializes the model
func (m *InputModel) Init() tea.Cmd {
	return textarea.Blink
}

// Update handles messages
func (m *InputModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd

	switch msg := msg.(type) {
	case editorFinishedMsg:
		// External editor finished
		if msg.err == nil && len(msg.content) > 0 {
			m.textarea.SetValue(string(msg.content))
		}
		return m, nil

	case SuspendInputMsg:
		// Save current value and suspend
		m.savedValue = m.textarea.Value()
		m.suspended = true
		return m, tea.ClearScreen

	case ResumeInputMsg:
		// Restore value and resume
		m.textarea.SetValue(m.savedValue)
		m.suspended = false
		return m, nil

	case ChangeInputTypeMsg:
		// Change input type (e.g., from approval to feedback)
		m.inputType = msg.InputType
		m.title = msg.Title
		m.placeholder = msg.Placeholder
		m.textarea.Placeholder = msg.Placeholder
		m.textarea.SetValue("")
		m.textarea.Focus()

		if msg.InputType == InputTypeApproval {
			m.approvalOptions = []string{
				"Yes",
				"Yes, and don't ask again for this task",
				"No, with feedback",
			}
			m.selectedOption = 0
		}
		return m, nil

	default:
		// Forward all other messages to textarea (including blink ticks)
		if !m.suspended && (m.inputType == InputTypeMessage || m.inputType == InputTypeFeedback) {
			m.textarea, cmd = m.textarea.Update(msg)
			return m, cmd
		}

	case tea.KeyMsg:
		if m.suspended {
			return m, nil
		}

		// Handle keys for text input types (Message/Feedback)
		if m.inputType == InputTypeMessage || m.inputType == InputTypeFeedback {
			switch msg.String() {
			case "ctrl+c":
				return m, func() tea.Msg { return InputCancelMsg{} }

			case "ctrl+e":
				// Open external editor (like huh does)
				return m, m.openEditor()

			case "enter":
				// Intercept enter for submit (textarea handles alt+enter and ctrl+j for newlines)
				return m.handleSubmit()

			case "up", "down", "left", "right":
				// Let textarea handle navigation
				m.textarea, cmd = m.textarea.Update(msg)
				return m, cmd
			}

			// Pass all other keys to textarea (including alt+enter, ctrl+j for newlines)
			m.textarea, cmd = m.textarea.Update(msg)
			return m, cmd
		}

		// Handle keys for approval type
		if m.inputType == InputTypeApproval {
			switch msg.String() {
			case "ctrl+c":
				return m, func() tea.Msg { return InputCancelMsg{} }

			case "enter":
				return m.handleSubmit()

			case "up":
				if m.selectedOption > 0 {
					m.selectedOption--
				}
				return m, nil

			case "down":
				if m.selectedOption < len(m.approvalOptions)-1 {
					m.selectedOption++
				}
				return m, nil
			}
		}
	}

	return m, nil
}

// handleSubmit handles submission based on input type
func (m *InputModel) handleSubmit() (tea.Model, tea.Cmd) {
	switch m.inputType {
	case InputTypeMessage:
		value := strings.TrimSpace(m.textarea.Value())
		return m, func() tea.Msg {
			return InputSubmitMsg{
				Value:     value,
				InputType: InputTypeMessage,
			}
		}

	case InputTypeApproval:
		selected := m.approvalOptions[m.selectedOption]
		approved := strings.HasPrefix(selected, "Yes")
		needsFeedback := strings.Contains(selected, "feedback")
		noAskAgain := strings.Contains(selected, "don't ask again")

		if needsFeedback {
			// Store the approval decision before switching to feedback input
			m.pendingApproval = approved
			// Switch to feedback input
			return m, func() tea.Msg {
				return ChangeInputTypeMsg{
					InputType:   InputTypeFeedback,
					Title:       "Your feedback",
					Placeholder: "/plan or /act to switch modes\nctrl+e to open editor",
				}
			}
		}

		return m, func() tea.Msg {
			return InputSubmitMsg{
				Value:         "",
				InputType:     InputTypeApproval,
				Approved:      approved,
				NeedsFeedback: false,
				NoAskAgain:    noAskAgain,
			}
		}

	case InputTypeFeedback:
		value := strings.TrimSpace(m.textarea.Value())
		return m, func() tea.Msg {
			return InputSubmitMsg{
				Value:     value,
				InputType: InputTypeFeedback,
				Approved:  m.pendingApproval, // Pass the stored approval decision
			}
		}
	}

	return m, nil
}

// View renders the model
func (m *InputModel) View() string {
	if m.suspended {
		return ""
	}

	var parts []string

	// Render title with mode indicator
	yellow := lipgloss.Color("3")
	blue := lipgloss.Color("39")

	modeStyle := lipgloss.NewStyle().Bold(true)
	if m.currentMode == "plan" {
		modeStyle = modeStyle.Foreground(yellow)
	} else {
		modeStyle = modeStyle.Foreground(blue)
	}

	modeIndicator := modeStyle.Render(fmt.Sprintf("[%s mode]", m.currentMode))
	titleText := m.styles.title.Render(m.title)
	fullTitle := fmt.Sprintf("%s %s", modeIndicator, titleText)
	parts = append(parts, fullTitle)

	// Render based on input type
	switch m.inputType {
	case InputTypeMessage, InputTypeFeedback:
		parts = append(parts, m.textarea.View())

	case InputTypeApproval:
		var options []string
		for i, option := range m.approvalOptions {
			if i == m.selectedOption {
				options = append(options, m.styles.selector.Render("")+m.styles.selectedOption.Render(option))
			} else {
				options = append(options, "  "+m.styles.option.Render(option))
			}
		}
		parts = append(parts, strings.Join(options, "\n"))
	}

	// Wrap everything in the base style with border
	content := strings.Join(parts, "\n")
	rendered := m.styles.base.Render(content)

	// Add newline before the form (outside the border)
	rendered = "\n" + rendered

	// Track height for cleanup
	m.lastHeight = lipgloss.Height(rendered)

	return rendered
}

// ClearScreen returns the ANSI codes to clear the input from the terminal
// This is used when submitting to remove the form cleanly
func (m *InputModel) ClearScreen() string {
	if m.lastHeight == 0 {
		return ""
	}

	// Move cursor up by lastHeight lines and clear from cursor to end of screen
	return fmt.Sprintf("\033[%dA\033[J", m.lastHeight)
}

// Clone creates a deep copy of the InputModel with all state preserved
func (m *InputModel) Clone() *InputModel {
	// Create new textarea with same configuration
	ta := textarea.New()
	ta.SetValue(m.textarea.Value())
	ta.Placeholder = m.placeholder
	ta.CharLimit = 0
	ta.ShowLineNumbers = false
	ta.Prompt = ""
	ta.SetHeight(5)
	ta.SetWidth(INPUT_WIDTH) 
	ta.Focus()

	// Configure keybindings
	ta.KeyMap.InsertNewline.SetKeys("alt+enter", "ctrl+j")

	// Apply styles (including mode-based cursor color)
	cursorColor := lipgloss.Color("3") // Yellow for plan
	if m.currentMode == "act" {
		cursorColor = lipgloss.Color("39") // Blue for act
	}

	ta.FocusedStyle.CursorLine = lipgloss.NewStyle()
	ta.FocusedStyle.EndOfBuffer = lipgloss.NewStyle()
	ta.FocusedStyle.Placeholder = m.styles.placeholder
	ta.FocusedStyle.Text = m.styles.textArea
	ta.FocusedStyle.Prompt = lipgloss.NewStyle()
	ta.Cursor.Style = lipgloss.NewStyle().Foreground(cursorColor)
	ta.Cursor.TextStyle = m.styles.textArea

	// Create cloned model
	clone := &InputModel{
		textarea:        ta,
		suspended:       false, // New program starts unsuspended
		savedValue:      m.savedValue,
		inputType:       m.inputType,
		title:           m.title,
		placeholder:     m.placeholder,
		currentMode:     m.currentMode,
		width:           m.width,
		lastHeight:      m.lastHeight,
		approvalOptions: m.approvalOptions,
		selectedOption:  m.selectedOption,
		pendingApproval: m.pendingApproval, // Preserve approval decision
		styles:          m.styles,
	}

	return clone
}

// openEditor opens an external editor for composing the message
func (m *InputModel) openEditor() tea.Cmd {
	// Get editor from environment or use nano as default
	editorCmd := "nano"
	editorArgs := []string{}

	if editor := os.Getenv("EDITOR"); editor != "" {
		editorFields := strings.Fields(editor)
		if len(editorFields) > 0 {
			editorCmd = editorFields[0]
			if len(editorFields) > 1 {
				editorArgs = editorFields[1:]
			}
		}
	}

	// Create temp file with current content
	tmpFile, err := os.CreateTemp(os.TempDir(), "*.md")
	if err != nil {
		return func() tea.Msg {
			return editorFinishedMsg{err: err}
		}
	}

	// Write current textarea value to temp file
	if err := os.WriteFile(tmpFile.Name(), []byte(m.textarea.Value()), 0o644); err != nil {
		return func() tea.Msg {
			return editorFinishedMsg{err: err}
		}
	}

	// Open the editor
	cmd := exec.Command(editorCmd, append(editorArgs, tmpFile.Name())...)
	return tea.ExecProcess(cmd, func(err error) tea.Msg {
		content, readErr := os.ReadFile(tmpFile.Name())
		_ = os.Remove(tmpFile.Name())

		if readErr != nil {
			return editorFinishedMsg{err: readErr}
		}

		return editorFinishedMsg{content: content, err: err}
	})
}
