package output

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
)

// InputType represents the type of input being collected
type InputType int

const (
	InputTypeMessage InputType = iota
	InputTypeApproval
	InputTypeFeedback
)

// InputSubmitMsg is sent when the user submits input
type InputSubmitMsg struct {
	Value      string
	InputType  InputType
	Approved   bool   // For approval type
	NeedsFeedback bool // For approval type
}

// InputCancelMsg is sent when the user cancels input (Ctrl+C)
type InputCancelMsg struct{}

// ChangeInputTypeMsg changes the current input type
type ChangeInputTypeMsg struct {
	InputType InputType
	Title     string
	Placeholder string
}

// InputModel is the bubbletea model for interactive input
type InputModel struct {
	textInput   textinput.Model
	suspended   bool
	savedValue  string
	inputType   InputType
	title       string
	placeholder string
	currentMode string // "plan" or "act"

	// For approval type
	approvalOptions []string
	selectedOption  int
}

// NewInputModel creates a new input model
func NewInputModel(inputType InputType, title, placeholder, currentMode string) InputModel {
	ti := textinput.New()
	ti.Placeholder = placeholder
	ti.Focus()
	ti.CharLimit = 0
	ti.Width = 80

	m := InputModel{
		textInput:   ti,
		inputType:   inputType,
		title:       title,
		placeholder: placeholder,
		currentMode: currentMode,
	}

	// For approval type, set up options
	if inputType == InputTypeApproval {
		m.approvalOptions = []string{
			"Yes",
			"Yes, with feedback",
			"No",
			"No, with feedback",
		}
		m.selectedOption = 0
	}

	return m
}

// Init initializes the model
func (m InputModel) Init() tea.Cmd {
	return textinput.Blink
}

// Update handles messages
func (m InputModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd

	switch msg := msg.(type) {
	case SuspendInputMsg:
		// Save current value and suspend
		m.savedValue = m.textInput.Value()
		m.suspended = true
		return m, tea.ClearScreen

	case ResumeInputMsg:
		// Restore value and resume
		m.textInput.SetValue(m.savedValue)
		m.suspended = false
		return m, nil

	case ChangeInputTypeMsg:
		// Change input type (e.g., from approval to feedback)
		m.inputType = msg.InputType
		m.title = msg.Title
		m.placeholder = msg.Placeholder
		m.textInput.Placeholder = msg.Placeholder
		m.textInput.SetValue("")
		m.textInput.Focus()

		if msg.InputType == InputTypeApproval {
			m.approvalOptions = []string{
				"Yes",
				"Yes, with feedback",
				"No",
				"No, with feedback",
			}
			m.selectedOption = 0
		}
		return m, nil

	case tea.KeyMsg:
		if m.suspended {
			return m, nil
		}

		switch msg.String() {
		case "ctrl+c":
			return m, func() tea.Msg { return InputCancelMsg{} }

		case "enter":
			return m.handleSubmit()

		case "up":
			if m.inputType == InputTypeApproval {
				if m.selectedOption > 0 {
					m.selectedOption--
				}
				return m, nil
			}

		case "down":
			if m.inputType == InputTypeApproval {
				if m.selectedOption < len(m.approvalOptions)-1 {
					m.selectedOption++
				}
				return m, nil
			}
		}

		// Update text input
		m.textInput, cmd = m.textInput.Update(msg)
		return m, cmd
	}

	return m, nil
}

// handleSubmit handles submission based on input type
func (m InputModel) handleSubmit() (tea.Model, tea.Cmd) {
	switch m.inputType {
	case InputTypeMessage:
		value := strings.TrimSpace(m.textInput.Value())
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

		if needsFeedback {
			// Switch to feedback input
			return m, func() tea.Msg {
				return ChangeInputTypeMsg{
					InputType:   InputTypeFeedback,
					Title:       "Your feedback",
					Placeholder: "Type your message... (shift+enter for new line, enter to submit, /plan or /act to switch mode)",
				}
			}
		}

		return m, func() tea.Msg {
			return InputSubmitMsg{
				Value:         "",
				InputType:     InputTypeApproval,
				Approved:      approved,
				NeedsFeedback: false,
			}
		}

	case InputTypeFeedback:
		value := strings.TrimSpace(m.textInput.Value())
		return m, func() tea.Msg {
			return InputSubmitMsg{
				Value:     value,
				InputType: InputTypeFeedback,
			}
		}
	}

	return m, nil
}

// View renders the model
func (m InputModel) View() string {
	if m.suspended {
		return ""
	}

	var s strings.Builder

	s.WriteString("\n")

	// Render title with mode indicator
	yellow := "\033[33m"
	blue := "\033[34m"
	indigo := "\033[38;5;99m"
	bold := "\033[1m"
	reset := "\033[0m"

	var coloredMode string
	if m.currentMode == "plan" {
		coloredMode = fmt.Sprintf("%s[plan mode]%s", yellow, reset)
	} else {
		coloredMode = fmt.Sprintf("%s[act mode]%s", blue, reset)
	}

	title := fmt.Sprintf("%s %s%s%s%s", coloredMode, bold, indigo, m.title, reset)
	s.WriteString(title + "\n\n")

	// Render based on input type
	switch m.inputType {
	case InputTypeMessage, InputTypeFeedback:
		s.WriteString(m.textInput.View())
		s.WriteString("\n")

	case InputTypeApproval:
		for i, option := range m.approvalOptions {
			if i == m.selectedOption {
				s.WriteString(fmt.Sprintf("> %s%s%s\n", bold, option, reset))
			} else {
				s.WriteString(fmt.Sprintf("  %s\n", option))
			}
		}
	}

	return s.String()
}
