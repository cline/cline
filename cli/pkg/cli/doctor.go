package cli

import (
	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/cli/pkg/cli/terminal"
	"github.com/cline/cli/pkg/cli/updater"
	"github.com/spf13/cobra"
)

// NewDoctorCommand creates the doctor command
func NewDoctorCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "doctor",
		Aliases: []string{"d"},
		Short:   "Configure terminal and check for updates",
		Long: `Diagnose and configure your terminal, and check for CLI updates.

This command:
  - Detects your terminal emulator (VS Code, Ghostty, Kitty, etc.)
  - Configures shift+enter to insert newlines in multiline input
  - Checks for CLI updates and auto-updates if available
  - Creates backups before modifying configuration files
  - Shows what was changed and where

Terminal configuration (shift+enter support):
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
  - Ctrl+J: Traditional Unix newline

Auto-update:
  - Checks npm registry for latest version
  - Automatically installs updates via npm
  - Respects NO_AUTO_UPDATE environment variable
  - Skipped in CI environments`,
		RunE: func(cmd *cobra.Command, args []string) error {
			// Configure terminal keybindings (sync - wait for completion)
			terminal.SetupKeyboard(true)

			// Check for updates (sync - wait for completion)
			updater.CheckAndUpdate(global.Config.Verbose, true)

			return nil
		},
	}

	return cmd
}
