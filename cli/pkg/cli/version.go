package cli

import (
	"fmt"
	"runtime"

	"github.com/spf13/cobra"
)

var (
	// These will be set at build time via ldflags
	Version   = "dev"
	Commit    = "unknown"
	Date      = "unknown"
	BuiltBy   = "unknown"
)

// NewVersionCommand creates the version command
func NewVersionCommand() *cobra.Command {
	var short bool

	cmd := &cobra.Command{
		Use:   "version",
		Short: "Show version information",
		Long:  `Display version information for the Cline Go host.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if short {
				fmt.Println(Version)
				return nil
			}

			fmt.Printf("Cline Go Host\n")
			fmt.Printf("Version:    %s\n", Version)
			fmt.Printf("Commit:     %s\n", Commit)
			fmt.Printf("Built:      %s\n", Date)
			fmt.Printf("Built by:   %s\n", BuiltBy)
			fmt.Printf("Go version: %s\n", runtime.Version())
			fmt.Printf("OS/Arch:    %s/%s\n", runtime.GOOS, runtime.GOARCH)

			return nil
		},
	}

	cmd.Flags().BoolVar(&short, "short", false, "show only version number")

	return cmd
}
