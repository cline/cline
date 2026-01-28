package slash

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/grpc-go/cline"
)

// Command represents a slash command available for autocomplete
type Command struct {
	Name          string
	Description   string
	Section       string // "default", "custom", or "cli"
	CLICompatible bool
}

// Registry holds available slash commands for autocomplete
type Registry struct {
	mu       sync.RWMutex
	commands []Command
}

// CLI-local commands (handled by CLI, not sent to backend)
var cliLocalCommands = []Command{
	{Name: "plan", Description: "Switch to plan mode", Section: "cli", CLICompatible: true},
	{Name: "act", Description: "Switch to act mode", Section: "cli", CLICompatible: true},
	{Name: "cancel", Description: "Cancel the current task", Section: "cli", CLICompatible: true},
	{Name: "exit", Description: "Exit follow mode", Section: "cli", CLICompatible: true},
}

// NewRegistry creates a new slash command registry
func NewRegistry(ctx context.Context) *Registry {
	defaultCommands := append([]Command{}, cliLocalCommands...)
	r := &Registry{
		commands: defaultCommands,
	}
	r.FetchFromBackend(ctx)
	return r
}

// FetchFromBackend fetches available commands from cline-core backend
func (r *Registry) FetchFromBackend(ctx context.Context) error {
	grpcClient, err := global.GetDefaultClient(ctx)
	if err != nil && global.Config.Verbose {
		fmt.Printf("Warning: could not get gRPC client: %v\n", err)
		return nil
	}
	resp, err := grpcClient.Slash.GetAvailableSlashCommands(ctx, &cline.EmptyRequest{})
	if err != nil && global.Config.Verbose {
		fmt.Printf("Warning: could not get gRPC client: %v\n", err)
		return nil
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	// Add backend commands (only CLI-compatible ones)
	for _, cmd := range resp.Commands {
		if cmd.CliCompatible {
			r.commands = append(r.commands, Command{
				Name:          cmd.Name,
				Description:   cmd.Description,
				Section:       cmd.Section,
				CLICompatible: cmd.CliCompatible,
			})
		}
	}

	return nil
}

// GetMatching returns commands that start with the given prefix (case-insensitive)
func (r *Registry) GetMatching(prefix string) []Command {
	r.mu.RLock()
	defer r.mu.RUnlock()

	prefix = strings.ToLower(prefix)
	var matches []Command
	for _, cmd := range r.commands {
		if strings.HasPrefix(strings.ToLower(cmd.Name), prefix) {
			matches = append(matches, cmd)
		}
	}
	return matches
}

// IsValid checks if a command name is valid
func (r *Registry) IsValid(name string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()

	name = strings.ToLower(name)
	for _, cmd := range r.commands {
		if strings.ToLower(cmd.Name) == name {
			return true
		}
	}
	return false
}

// IsCLILocal checks if a command is handled locally by CLI (not sent to backend)
func (r *Registry) IsCLILocal(name string) bool {
	name = strings.ToLower(name)
	for _, cmd := range cliLocalCommands {
		if strings.ToLower(cmd.Name) == name {
			return true
		}
	}
	return false
}

// HasCommands returns true if the registry has any commands loaded
func (r *Registry) HasCommands() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.commands) > 0
}

// ParseModeSwitch checks if message starts with /act or /plan and extracts the mode and remaining message.
// Returns (mode, remainingMessage, isModeSwitch).
// This is a package-level function so it can be used both during initial task creation
// and during interactive input handling.
func ParseModeSwitch(message string) (string, string, bool) {
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
