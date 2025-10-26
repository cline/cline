package output

import "fmt"

// MustNotBeJSON returns an error if JSON output mode is active.
// Use this at the start of interactive commands that cannot work with JSON output.
func MustNotBeJSON(outputFormat, commandName string) error {
	if outputFormat == "json" {
		return fmt.Errorf("%s is an interactive command and cannot be used with --output-format json", commandName)
	}
	return nil
}
