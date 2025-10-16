package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/cline/cli/pkg/cli/global"
	"github.com/spf13/cobra"
)

type PackageInfo struct {
	Version string `json:"version"`
}

// getCliVersion reads the CLI version from package.json
func getCliVersion() string {
	// Try to find package.json relative to the executable
	execPath, err := os.Executable()
	if err != nil {
		return "unknown"
	}
	
	// Look for package.json in the same directory as the executable
	packagePath := filepath.Join(filepath.Dir(execPath), "package.json")
	
	// If not found, try parent directory (for development builds)
	if _, err := os.Stat(packagePath); os.IsNotExist(err) {
		packagePath = filepath.Join(filepath.Dir(execPath), "..", "package.json")
	}
	
	// If still not found, try cli directory from project root
	if _, err := os.Stat(packagePath); os.IsNotExist(err) {
		packagePath = filepath.Join(filepath.Dir(execPath), "..", "..", "cli", "package.json")
	}
	
	data, err := os.ReadFile(packagePath)
	if err != nil {
		return "unknown"
	}
	
	var pkgInfo PackageInfo
	if err := json.Unmarshal(data, &pkgInfo); err != nil {
		return "unknown"
	}
	
	return pkgInfo.Version
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
			// Get CLI version from package.json
			cliVersion := getCliVersion()

			if short {
				fmt.Println(cliVersion)
				return nil
			}

			fmt.Printf("Cline CLI\n")
			fmt.Printf("Cline CLI Version:  %s\n", cliVersion)
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