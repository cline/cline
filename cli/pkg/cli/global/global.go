package global

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/charmbracelet/lipgloss"
	"github.com/cline/cli/pkg/common"
	"github.com/cline/grpc-go/client"
	"github.com/muesli/termenv"
)

type Port uint16

type GlobalConfig struct {
	ConfigPath   string
	Verbose      bool
	OutputFormat string
	CoreAddress  string
}

var (
	Config  *GlobalConfig
	Clients *ClineClients

	// Version info - set at build time via ldflags
	// Version is the Cline Core version (from root package.json)
	Version = "dev"
	// CliVersion is the CLI package version (from cli/package.json)
	CliVersion = "dev"
	Commit     = "unknown"
	Date       = "unknown"
	BuiltBy    = "unknown"
)

func InitializeGlobalConfig(cfg *GlobalConfig) error {
	if cfg.ConfigPath == "" {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return fmt.Errorf("failed to get home directory: %w", err)
		}
		cfg.ConfigPath = filepath.Join(homeDir, ".cline")
	}

	// Ensure .cline directory exists
	if err := os.MkdirAll(cfg.ConfigPath, 0755); err != nil {
		return fmt.Errorf("failed to create config directory: %w", err)
	}

	// Configure lipgloss color profile based on output format
	if cfg.OutputFormat == "plain" {
		lipgloss.SetColorProfile(termenv.Ascii) // NO COLOR mode
	}
	// Otherwise lipgloss auto-detects terminal capabilities (default behavior)

	Config = cfg
	Clients = NewClineClients(cfg.ConfigPath)

	// Initialize the clients registry
	ctx := context.Background()
	if err := Clients.Initialize(ctx); err != nil {
		return fmt.Errorf("failed to initialize clients: %w", err)
	}

	return nil
}

// GetDefaultClient returns a client for the default instance or the address override
func GetDefaultClient(ctx context.Context) (*client.ClineClient, error) {
	if Config.CoreAddress != "" && Config.CoreAddress != fmt.Sprintf("localhost:%d", common.DEFAULT_CLINE_CORE_PORT) {
		// User specified a specific address, use that
		return Clients.GetRegistry().GetClient(ctx, Config.CoreAddress)
	}

	// Use the default instance from registry
	return Clients.GetRegistry().GetDefaultClient(ctx)
}

// GetClientForAddress returns a client for a specific address
func GetClientForAddress(ctx context.Context, address string) (*client.ClineClient, error) {
	return Clients.GetRegistry().GetClient(ctx, address)
}

// EnsureDefaultInstance ensures a default instance exists
func EnsureDefaultInstance(ctx context.Context) error {
	if Clients == nil {
		return fmt.Errorf("global clients not initialized")
	}

	registry := Clients.GetRegistry()

	// First, check if there are any instances already registered in SQLite
	instances := registry.ListInstances()

	// Use the registry's EnsureDefaultInstance to auto-set first instance as default if needed
	if err := registry.EnsureDefaultInstance(instances); err != nil {
		return fmt.Errorf("failed to ensure default from existing instances: %w", err)
	}

	// Now check if we have a default set
	if registry.GetDefaultInstance() == "" {
		// No instances exist, start a new one
		// Note: StartNewInstance will automatically set it as default since it's the first instance
		_, err := Clients.StartNewInstance(ctx)
		if err != nil {
			return fmt.Errorf("failed to start new default instance: %w", err)
		}
	}

	return nil
}