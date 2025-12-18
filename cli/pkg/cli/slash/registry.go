package slash

import (
	"context"
	"strings"
	"sync"

	"github.com/cline/grpc-go/client"
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
func NewRegistry() *Registry {
	return &Registry{
		commands: make([]Command, 0),
	}
}

// FetchFromBackend fetches available commands from cline-core backend
func (r *Registry) FetchFromBackend(ctx context.Context, c *client.ClineClient) error {
	resp, err := c.Slash.GetAvailableSlashCommands(ctx, &cline.EmptyRequest{})
	if err != nil {
		return err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	// Start with CLI-local commands
	r.commands = append([]Command{}, cliLocalCommands...)

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

// GetCommands returns all available commands
func (r *Registry) GetCommands() []Command {
	r.mu.RLock()
	defer r.mu.RUnlock()

	// Return a copy to avoid race conditions
	result := make([]Command, len(r.commands))
	copy(result, r.commands)
	return result
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
