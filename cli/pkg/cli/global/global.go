package global

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/cline/cli/pkg/common"
	"github.com/cline/grpc-go/client"
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

	// Check if we have any instances in the registry
	registry := Clients.GetRegistry()
	if registry.GetDefaultInstance() == "" {
		// No default instance, start a new one
		instance, err := Clients.StartNewInstance(ctx)
		if err != nil {
			return fmt.Errorf("failed to start new default instance: %w", err)
		}

		// Set the new instance as default
		if err := registry.SetDefaultInstance(instance.Address); err != nil {
			return fmt.Errorf("failed to set default instance: %w", err)
		}
	}

	return nil
}
