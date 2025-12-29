package cli

import (
	"fmt"

	"github.com/cline/cli/pkg/cli/display"
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
		Short:   "Check system health and diagnose problems",
		Long: `Check the health of your Cline CLI installation and diagnose problems.

Currently this command performs the following checks and fixes:

Terminal Configuration:
  - Detects your terminal emulator (VS Code, Cursor, Ghostty, Kitty, WezTerm, Alacritty)
  - Configures shift+enter to insert newlines in multiline input
  - Creates backups before modifying configuration files
  - Supported terminals: VS Code, Cursor, Ghostty, Kitty, WezTerm, Alacritty
  - iTerm2 works by default, Terminal.app requires manual setup

CLI Updates:
  - Checks npm registry for the latest version
  - Automatically installs updates via npm if available
  - Respects NO_AUTO_UPDATE environment variable
  - Skipped in CI environments

Note: Future versions will include additional health checks for Node.js version,
npm availability, Cline Core connectivity, database integrity, and more.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runDoctorChecks()
		},
	}

	return cmd
}

// runDoctorChecks performs all doctor diagnostics and configuration
func runDoctorChecks() error {
	renderer := display.NewRenderer(global.Config.OutputFormat)

	fmt.Printf("\n%s\n\n", renderer.Bold("Cline Doctor - System Health Check"))

	// Configure terminal keybindings (terminal.go prints its own status)
	fmt.Printf("%s\n\n", renderer.Dim("━━━ Terminal Configuration ━━━"))
	terminal.SetupKeyboardSync()

	// Check for updates (updater.go prints its own status)
	fmt.Printf("\n%s\n\n", renderer.Dim("━━━ CLI Updates ━━━"))
	updater.CheckAndUpdateSync(global.Config.Verbose, true)

	// Summary
	fmt.Printf("\n%s\n", renderer.Dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"))
	fmt.Printf("\n%s\n\n", renderer.SuccessWithCheckmark("Health check complete"))

	return nil
}
