package global

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/cline/cli/pkg/cli/sqlite"
	"github.com/cline/cli/pkg/common"
	"github.com/cline/grpc-go/client"
	"github.com/cline/grpc-go/cline"
	"github.com/cline/grpc-go/host"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/health/grpc_health_v1"
)

// ClientRegistry manages Cline client connections using direct SQLite operations
type ClientRegistry struct {
	lockManager *sqlite.LockManager
	configPath  string
}

// NewClientRegistry creates a new client registry
func NewClientRegistry(configPath string) *ClientRegistry {
	lockManager, err := sqlite.NewLockManager(configPath)
	if err != nil {
		// Log error but continue - we can still function without SQLite
		log.Fatalf("Warning: Failed to initialize SQLite lock manager: %v\n", err)
	}

	return &ClientRegistry{
		lockManager: lockManager,
		configPath:  configPath,
	}
}

// GetDefaultInstance returns the default instance address from settings file
func (r *ClientRegistry) GetDefaultInstance() string {
	defaultAddr, err := sqlite.GetDefaultInstance(r.configPath)
	if err != nil {
		return ""
	}
	return defaultAddr
}

// SetDefaultInstance sets the default instance (writes default.json)
func (r *ClientRegistry) SetDefaultInstance(address string) error {
	// Verify the instance exists in SQLite
	if r.lockManager != nil {
		exists, err := r.lockManager.HasInstanceAtAddress(address)
		if err != nil {
			return fmt.Errorf("failed to check instance existence: %w", err)
		}
		if !exists {
			return fmt.Errorf("instance %s not found in registry", address)
		}
	}

	return sqlite.SetDefaultInstance(r.configPath, address)
}

// GetInstance returns instance information directly from SQLite
func (r *ClientRegistry) GetInstance(address string) (*common.CoreInstanceInfo, error) {
	if r.lockManager == nil {
		return nil, fmt.Errorf("lock manager not available")
	}

	return r.lockManager.GetInstanceInfo(address)
}

// GetClient returns a connected client for the given address (created on-demand)
func (r *ClientRegistry) GetClient(ctx context.Context, address string) (*client.ClineClient, error) {
	// Verify instance exists in SQLite
	if r.lockManager != nil {
		exists, err := r.lockManager.HasInstanceAtAddress(address)
		if err != nil {
			return nil, fmt.Errorf("failed to check instance existence: %w", err)
		}
		if !exists {
			return nil, fmt.Errorf("instance %s not found", address)
		}
	}

	// Create client on-demand (no caching)
	target, err := common.NormalizeAddressForGRPC(address)
	if err != nil {
		return nil, fmt.Errorf("invalid address %s: %w", address, err)
	}

	cl, err := client.NewClineClient(target)
	if err != nil {
		return nil, fmt.Errorf("failed to create client for %s: %w", target, err)
	}

	if err := cl.Connect(ctx); err != nil {
		return nil, fmt.Errorf("failed to connect to %s: %w", target, err)
	}

	return cl, nil
}

// GetDefaultClient returns a client for the default instance
func (r *ClientRegistry) GetDefaultClient(ctx context.Context) (*client.ClineClient, error) {
	defaultAddr := r.GetDefaultInstance()
	if defaultAddr == "" {
		return nil, fmt.Errorf("no default instance configured")
	}

	// Check if the default instance actually exists in the database
	if r.lockManager != nil {
		exists, err := r.lockManager.HasInstanceAtAddress(defaultAddr)
		if err != nil {
			// Database is unavailable - Return error instead of attempting cleanup
			return nil, fmt.Errorf("cannot verify default instance: database unavailable: %w", err)
		}
		
		if !exists {
			// Instance doesn't exist in database but config file references it
			// This is a stale config - remove it and try to find another instance
			settingsPath := filepath.Join(r.configPath, common.SETTINGS_SUBFOLDER, "settings", "cli-default-instance.json")
			if removeErr := os.Remove(settingsPath); removeErr != nil && !os.IsNotExist(removeErr) {
				fmt.Printf("Warning: Failed to remove stale default instance config: %v\n", removeErr)
			} else {
				fmt.Printf("Removed stale default instance config (instance %s not found in database)\n", defaultAddr)
			}
			
			// Try to find and set a new default instance
			instances := r.ListInstances()
			if len(instances) > 0 {
				if err := r.EnsureDefaultInstance(instances); err != nil {
					return nil, fmt.Errorf("failed to set new default instance: %w", err)
				}
				
				// Retry with the new default
				newDefaultAddr := r.GetDefaultInstance()
				if newDefaultAddr != "" {
					fmt.Printf("Set new default instance: %s\n", newDefaultAddr)
					return r.GetClient(ctx, newDefaultAddr)
				}
			}
			
			return nil, fmt.Errorf("no default instance configured")
		}
	}

	return r.GetClient(ctx, defaultAddr)
}

// ListInstances returns all registered instances directly from SQLite
func (r *ClientRegistry) ListInstances() []*common.CoreInstanceInfo {
	if r.lockManager == nil {
		return []*common.CoreInstanceInfo{}
	}

	// Use context with timeout for health checks
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	instances, err := r.lockManager.ListInstancesWithHealthCheck(ctx)
	if err != nil {
		fmt.Printf("Warning: Failed to list instances: %v\n", err)
		return []*common.CoreInstanceInfo{}
	}

	return instances
}

// HasInstanceAtAddress checks if an instance exists at the given address (delegates to SQLite)
func (r *ClientRegistry) HasInstanceAtAddress(address string) bool {
	if r.lockManager == nil {
		return false
	}

	exists, err := r.lockManager.HasInstanceAtAddress(address)
	if err != nil {
		fmt.Printf("Warning: Failed to check instance existence: %v\n", err)
		return false
	}

	return exists
}

// CleanupStaleInstances removes stale instances using direct SQLite operations
func (r *ClientRegistry) CleanupStaleInstances(ctx context.Context) error {
	if r.lockManager == nil {
		return nil
	}

	// Get all instances with health checks
	instances, err := r.lockManager.ListInstancesWithHealthCheck(ctx)
	if err != nil {
		return fmt.Errorf("failed to list instances for cleanup: %w", err)
	}

	// Clean up all stale instances
	for _, instance := range instances {
		if instance.Status != grpc_health_v1.HealthCheckResponse_SERVING {
			// Try to gracefully shutdown the paired host process before cleanup

			fmt.Printf("Attempting to shutdown dangling host service %s for stale cline core instance %s\n",
				instance.HostServiceAddress, instance.Address)
			r.tryShutdownHostProcess(instance.HostServiceAddress)

			// Remove from SQLite database
			if err := r.lockManager.RemoveInstanceLock(instance.Address); err != nil {
				return fmt.Errorf("failed to remove stale instance %s: %w", instance.Address, err)
			}

			fmt.Printf("Removed stale instance: %s\n", instance.Address)
		}
	}

	return nil
}

// tryShutdownHostProcess attempts to gracefully shutdown a host process via RPC
// Best effort, don't throw errors i guess
func (r *ClientRegistry) tryShutdownHostProcess(hostServiceAddress string) {
	err := common.RetryOperation(3, 2*time.Second, func() error {
		// Create context with timeout
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		// Create gRPC connection to host bridge
		conn, err := grpc.DialContext(ctx, hostServiceAddress,
			grpc.WithTransportCredentials(insecure.NewCredentials()),
			grpc.WithBlock())
		if err != nil {
			return fmt.Errorf("connection failed: %w", err)
		}
		defer conn.Close()

		// Create env service client and call shutdown
		envClient := host.NewEnvServiceClient(conn)
		_, err = envClient.Shutdown(ctx, &cline.EmptyRequest{})
		if err != nil {
			return fmt.Errorf("RPC failed: %w", err)
		}

		return nil
	})

	if err != nil {
		fmt.Printf("Warning: Failed to request host bridge shutdown on port %s: %v\n", hostServiceAddress, err)
	} else {
		fmt.Printf("Host bridge shutdown requested successfully on port %s\n", hostServiceAddress)
	}
}

// ListInstancesCleaned performs cleanup and returns instances with health checks
func (r *ClientRegistry) ListInstancesCleaned(ctx context.Context) ([]*common.CoreInstanceInfo, error) {
	// 1. Clean up stale entries (best-effort)
	_ = r.CleanupStaleInstances(ctx)

	// 2. Get all instances with real-time health checks
	instances := r.ListInstances()

	// 3. Ensure default is set if instances exist
	if err := r.EnsureDefaultInstance(instances); err != nil {
		fmt.Printf("Warning: Failed to ensure default instance: %v\n", err)
	}

	return instances, nil
}

// EnsureDefaultInstance ensures a default instance is set if instances exist but no default is configured
func (r *ClientRegistry) EnsureDefaultInstance(instances []*common.CoreInstanceInfo) error {
	currentDefault := r.GetDefaultInstance()

	// If we have no instances, clear any stale default and remove settings file
	if len(instances) == 0 {
		if currentDefault != "" {
			// Remove the settings file since no instances exist
			settingsPath := filepath.Join(r.configPath, common.SETTINGS_SUBFOLDER, "settings", "cli-default-instance.json")
			_ = os.Remove(settingsPath)
		}
		return nil
	}

	// If we have instances but no default, pick the first one
	if currentDefault == "" {
		return sqlite.SetDefaultInstance(r.configPath, instances[0].Address)
	}

	// Validate current default still exists in the instances
	defaultExists := false
	for _, instance := range instances {
		if instance.Address == currentDefault {
			defaultExists = true
			break
		}
	}

	if !defaultExists {
		// Current default doesn't exist, pick a new one from available instances
		return sqlite.SetDefaultInstance(r.configPath, instances[0].Address)
	}

	return nil
}
