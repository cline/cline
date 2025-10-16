package cli

import (
	"github.com/cline/cli/pkg/cli/terminal"
	"github.com/spf13/cobra"
)

// NewDoctorCommand creates the doctor command
func NewDoctorCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "doctor",
		Aliases: []string{"d"},
		Short:   "Configure terminal for optimal Cline CLI experience",
		Long: `Diagnose and configure your terminal for the best Cline CLI experience.

This command:
  - Detects your terminal emulator (VS Code, Ghostty, Kitty, etc.)
  - Configures shift+enter to insert newlines in multiline input
  - Creates backups before modifying configuration files
  - Shows what was changed and where

Supported terminals:
  - VS Code integrated terminal (automatic)
  - Cursor (automatic)
  - Ghostty (automatic)
  - Kitty (automatic)
  - WezTerm (automatic)
  - Alacritty (automatic)
  - iTerm2 (already works by default)
  - Terminal.app (manual setup required)

After configuration, you can use:
  - Enter: Submit your message
  - Shift+Enter: Insert a newline for multiline messages
  - Alt+Enter: Alternative for newline (fallback)
  - Ctrl+J: Traditional Unix newline`,
		RunE: func(cmd *cobra.Command, args []string) error {
			terminal.SetupKeyboard()
			return nil
		},
	}

	return cmd
}
