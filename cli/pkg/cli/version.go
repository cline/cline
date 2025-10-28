package cli

import (
	"fmt"
	"runtime"

	"github.com/cline/cli/pkg/cli/global"
	"github.com/spf13/cobra"
)

// NewVersionCommand creates the version command
func NewVersionCommand() *cobra.Command {
	var short bool

	cmd := &cobra.Command{
		Use:     "version",
		Aliases: []string{"v"},
		Short:   "Show version information",
		Long:    `Display version information for the Cline CLI.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			// Versions are injected at build time via ldflags
			if short {
				fmt.Println(global.CliVersion)
				return nil
			}

			fmt.Printf("Cline CLI\n")
			fmt.Printf("Cline CLI Version:  %s\n", global.CliVersion)
			fmt.Printf("Cline Core Version: %s\n", global.Version)
			fmt.Printf("Commit:             %s\n", global.Commit)
			fmt.Printf("Built:              %s\n", global.Date)
			fmt.Printf("Built by:           %s\n", global.BuiltBy)
			fmt.Printf("Go version:         %s\n", runtime.Version())
			fmt.Printf("OS/Arch:            %s/%s\n", runtime.GOOS, runtime.GOARCH)

			return nil
		},
	}

	cmd.Flags().BoolVar(&short, "short", false, "show only version number")

	return cmd
}