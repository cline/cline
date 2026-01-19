package cli

import (
	"fmt"
	"runtime"

	"github.com/cline/cli/pkg/cli/global"
	"github.com/spf13/cobra"
)

// VersionString returns the full version information string
func VersionString() string {
	return fmt.Sprintf(`Cline CLI
Cline CLI Version:  %s
Cline Core Version: %s
Commit:             %s
Built:              %s
Built by:           %s
Go version:         %s
OS/Arch:            %s/%s
`, global.CliVersion, global.Version, global.Commit, global.Date, global.BuiltBy, runtime.Version(), runtime.GOOS, runtime.GOARCH)
}

// NewVersionCommand creates the version command
func NewVersionCommand() *cobra.Command {
	var short bool

	cmd := &cobra.Command{
		Use:     "version",
		Aliases: []string{"v"},
		Short:   "Show version information",
		Long:    `Display version information for the Cline CLI.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if short {
				fmt.Println(global.CliVersion)
				return nil
			}
			fmt.Print(VersionString())
			return nil
		},
	}

	cmd.Flags().BoolVar(&short, "short", false, "show only version number")

	return cmd
}