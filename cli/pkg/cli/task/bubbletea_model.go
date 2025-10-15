package task

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/v2/cursor"
	"github.com/charmbracelet/bubbles/v2/list"
	"github.com/charmbracelet/bubbles/v2/textarea"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/cline/cli/pkg/cli/display"
	"github.com/cline/cli/pkg/cli/types"
)

// InputMode represents the current state of the input UI
type InputMode int

const (
	InputModeHidden   InputMode = iota // No input shown
	InputModeMessage                   // Textarea for messages
	InputModeApproval                  // List for approval selection
	InputModeFeedback                  // Textarea for feedback after approval
)

// InteractiveModel is the BubbleTea model for interactive CLI input
type InteractiveModel struct {
	// UI components
	textarea     *textarea.Model
	approvalList list.Model

	// References
	manager    *Manager
	cancelFunc context.CancelFunc
	ctx        context.Context

	// State
	inputMode  InputMode
	prevMode   InputMode // Track previous mode for transitions
	width      int
	height     int

	// Mode tracking
	currentMode string // "plan" or "act"

	// Approval state
	approvalMsg    *types.ClineMessage
	approvalChoice string // "yes_feedback", "no_feedback", etc.

	// Styles
	styles approvalStyles
}

type approvalStyles struct {
	title        lipgloss.Style
	item         lipgloss.Style
	selectedItem lipgloss.Style
}

// Approval option item
type approvalItem string

func (i approvalItem) FilterValue() string { return "" }
func (i approvalItem) Title() string       { return string(i) }
func (i approvalItem) Description() string { return "" }

// Approval list delegate
type approvalDelegate struct {
	styles *approvalStyles
}

func (d approvalDelegate) Height() int                             { return 1 }
func (d approvalDelegate) Spacing() int                            { return 0 }
func (d approvalDelegate) Update(_ tea.Msg, _ *list.Model) tea.Cmd { return nil }
func (d approvalDelegate) Render(w io.Writer, m list.Model, index int, listItem list.Item) {
	i, ok := listItem.(approvalItem)
	if !ok {
		return
	}

	str := string(i)
	fn := d.styles.item.Render
	if index == m.Index() {
		fn = func(s ...string) string {
			return d.styles.selectedItem.Render("> " + strings.Join(s, " "))
		}
	}

	fmt.Fprint(w, fn(str))
}

// pollTickMsg triggers a check of whether input should be shown
type pollTickMsg struct{}

func pollForInputState() tea.Cmd {
	return tea.Tick(500*time.Millisecond, func(t time.Time) tea.Msg {
		return pollTickMsg{}
	})
}

// NewInteractiveModel creates a new interactive model
func NewInteractiveModel(manager *Manager, cancelFunc context.CancelFunc, ctx context.Context) InteractiveModel {
	// Setup textarea
	ta := textarea.New()
	ta.Placeholder = "Type your message... (shift+enter for new line, enter to submit, /plan or /act to switch mode)"
	ta.SetVirtualCursor(true)
	ta.Focus()
	ta.SetHeight(5)
	ta.ShowLineNumbers = false
	ta.Styles()

	taStyles := ta.Styles()
	taStyles.Cursor.Blink = true
	ta.SetStyles(taStyles)

	// Setup approval list
	items := []list.Item{
		approvalItem("Yes"),
		approvalItem("Yes, with feedback"),
		approvalItem("No"),
		approvalItem("No, with feedback"),
	}

	styles := approvalStyles{
		title:        lipgloss.NewStyle().MarginLeft(2).Bold(true),
		item:         lipgloss.NewStyle().PaddingLeft(4),
		selectedItem: lipgloss.NewStyle().PaddingLeft(2).Foreground(lipgloss.Color("170")),
	}

	delegate := approvalDelegate{styles: &styles}
	approvalList := list.New(items, delegate, 40, 8) // Height: 1 title + 4 items + 3 padding
	approvalList.Title = "Let Cline use this tool?"
	approvalList.SetShowStatusBar(false)
	approvalList.SetFilteringEnabled(false)
	approvalList.SetShowPagination(false) 
	approvalList.SetShowHelp(true)     
	approvalList.Styles.Title = styles.title

	return InteractiveModel{
		textarea:     ta,
		approvalList: approvalList,
		manager:      manager,
		cancelFunc:   cancelFunc,
		ctx:          ctx,
		inputMode:    InputModeHidden,
		prevMode:     InputModeHidden,
		currentMode:  "act", // Default to act mode
		styles:       styles,
	}
}

func (m InteractiveModel) Init() tea.Cmd {
	return tea.Batch(
		textarea.Blink,
		pollForInputState(),
	)
}

func (m InteractiveModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case display.PrintMsg:
		// Handle print messages from display singleton
		return m, tea.Printf("%s", string(msg))

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.textarea.SetWidth(msg.Width)
		m.approvalList.SetWidth(msg.Width)
		return m, nil

	case pollTickMsg:
		// Check if approval is needed
		needsApproval, approvalMsg, err := m.manager.CheckNeedsApproval(m.ctx)
		if err == nil && needsApproval {
			if m.inputMode != InputModeApproval {
				m.prevMode = m.inputMode
				m.inputMode = InputModeApproval
				m.approvalMsg = approvalMsg
			}
			return m, pollForInputState()
		}

		// Check if we can send a message
		err = m.manager.CheckSendEnabled(m.ctx)
		if err == nil {
			// Can send message
			if m.inputMode != InputModeMessage && m.inputMode != InputModeFeedback {
				m.prevMode = m.inputMode
				m.inputMode = InputModeMessage
				// Get current mode from manager
				m.currentMode = m.manager.GetCurrentMode()
			}
		} else {
			// Hide input
			if m.inputMode != InputModeHidden {
				m.prevMode = m.inputMode
				m.inputMode = InputModeHidden
			}
		}

		return m, pollForInputState()

	case tea.KeyPressMsg:
		switch m.inputMode {
		case InputModeApproval:
			switch msg.String() {
			case "ctrl+c", "esc":
				m.cancelFunc()
				return m, tea.Quit

			case "enter":
				// Get selected item
				selected := m.approvalList.SelectedItem()
				if selected == nil {
					return m, nil
				}

				choice := string(selected.(approvalItem))
				switch choice {
				case "Yes":
					m.sendApproval(true, "")
					m.inputMode = InputModeHidden
				case "Yes, with feedback":
					m.approvalChoice = "yes"
					m.inputMode = InputModeFeedback
					m.textarea.Reset()
					m.textarea.Focus()
				case "No":
					m.sendApproval(false, "")
					m.inputMode = InputModeHidden
				case "No, with feedback":
					m.approvalChoice = "no"
					m.inputMode = InputModeFeedback
					m.textarea.Reset()
					m.textarea.Focus()
				}
				return m, nil

			default:
				// Pass to list for navigation
				var cmd tea.Cmd
				m.approvalList, cmd = m.approvalList.Update(msg)
				return m, cmd
			}

		case InputModeFeedback:
			switch msg.String() {
			case "ctrl+c", "esc":
				m.cancelFunc()
				return m, tea.Quit

			case "enter":
				// Send approval with feedback
				feedback := strings.TrimSpace(m.textarea.Value())
				approved := m.approvalChoice == "yes"
				m.sendApproval(approved, feedback)
				m.textarea.Reset()
				m.inputMode = InputModeHidden
				return m, nil

			default:
				// Pass to textarea
				var cmd tea.Cmd
				m.textarea, cmd = m.textarea.Update(msg)
				return m, cmd
			}

		case InputModeMessage:
			switch msg.String() {
			case "ctrl+c", "esc":
				m.cancelFunc()
				return m, tea.Quit

			case "enter":
				message := strings.TrimSpace(m.textarea.Value())
				if message == "" {
					return m, nil
				}

				// Handle mode switching
				if newMode, remainingMessage, isModeSwitch := m.parseModeSwitch(message); isModeSwitch {
					if err := m.manager.SetMode(m.ctx, newMode, nil, nil, nil); err == nil {
						m.currentMode = newMode
						if remainingMessage != "" {
							message = remainingMessage
						} else {
							m.textarea.Reset()
							return m, nil
						}
					}
				}

				// Handle special commands
				if m.handleSpecialCommand(message) {
					m.textarea.Reset()
					return m, nil
				}

				// Send the message
				if err := m.manager.SendMessage(m.ctx, message, nil, nil, ""); err != nil {
					// Error sending, but don't crash - just log it
					fmt.Printf("\nError sending message: %v\n", err)
				}

				m.textarea.Reset()
				m.inputMode = InputModeHidden
				return m, nil

			default:
				// Pass to textarea
				var cmd tea.Cmd
				m.textarea, cmd = m.textarea.Update(msg)
				return m, cmd
			}
		}

	case cursor.BlinkMsg:
		// Textarea needs cursor blinks
		var cmd tea.Cmd
		m.textarea, cmd = m.textarea.Update(msg)
		return m, cmd
	}

	return m, tea.Batch(cmds...)
}

func (m InteractiveModel) View() string {
	switch m.inputMode {
	case InputModeHidden:
		return "" // Nothing shown - pure stdout mode

	case InputModeMessage:
		// Show mode indicator and textarea
		modeColor := "\033[34m" // Blue for act
		if m.currentMode == "plan" {
			modeColor = "\033[33m" // Yellow for plan
		}
		reset := "\033[0m"

		title := fmt.Sprintf("\n%s[%s mode]%s Cline is ready for your message", modeColor, m.currentMode, reset)
		return title + "\n" + m.textarea.View()

	case InputModeApproval:
		return "\n" + m.approvalList.View()

	case InputModeFeedback:
		return "\nYour feedback:\n" + m.textarea.View()
	}

	return ""
}

// sendApproval sends approval response to the manager
func (m *InteractiveModel) sendApproval(approved bool, feedback string) {
	approveStr := "false"
	if approved {
		approveStr = "true"
	}

	if err := m.manager.SendMessage(m.ctx, feedback, nil, nil, approveStr); err != nil {
		fmt.Printf("\nError sending approval: %v\n", err)
	}
}

// parseModeSwitch checks if message starts with /act or /plan
func (m *InteractiveModel) parseModeSwitch(message string) (string, string, bool) {
	trimmed := strings.TrimSpace(message)
	lower := strings.ToLower(trimmed)

	if strings.HasPrefix(lower, "/plan") {
		remaining := strings.TrimSpace(trimmed[5:])
		return "plan", remaining, true
	}

	if strings.HasPrefix(lower, "/act") {
		remaining := strings.TrimSpace(trimmed[4:])
		return "act", remaining, true
	}

	return "", message, false
}

// handleSpecialCommand processes special commands like /cancel, /exit
func (m *InteractiveModel) handleSpecialCommand(message string) bool {
	switch strings.ToLower(strings.TrimSpace(message)) {
	case "/cancel":
		if err := m.manager.CancelTask(m.ctx); err != nil {
			fmt.Printf("Error cancelling task: %v\n", err)
		} else {
			fmt.Println("Task cancelled successfully")
		}
		return true
	case "/exit", "/quit":
		fmt.Println("\nExiting follow mode...")
		m.cancelFunc()
		return true
	default:
		return false
	}
}
