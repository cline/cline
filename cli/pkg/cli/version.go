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
		Long:    `Display version information for the Cline Go host.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if short {
				fmt.Println(global.Version)
				return nil
			}

			fmt.Printf("Cline Go Host\n")
			fmt.Printf("Version:    %s\n", global.Version)
			fmt.Printf("Commit:     %s\n", global.Commit)
			fmt.Printf("Built:      %s\n", global.Date)
			fmt.Printf("Built by:   %s\n", global.BuiltBy)
			fmt.Printf("Go version: %s\n", runtime.Version())
			fmt.Printf("OS/Arch:    %s/%s\n", runtime.GOOS, runtime.GOARCH)

			return nil
		},
	}

	cmd.Flags().BoolVar(&short, "short", false, "show only version number")

	return cmd
}
