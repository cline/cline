package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"time"

	"github.com/cline/cli/pkg/common"
	_ "github.com/glebarez/go-sqlite"
	"google.golang.org/grpc/health/grpc_health_v1"
)

// normalizeAddressVariants returns address variants to try when querying SQLite.
// Handles localhost/127.0.0.1 equivalence by returning both forms.
func normalizeAddressVariants(address string) []string {
	variants := []string{address}
	
	// Extract host and port
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return variants
	}
	
	// Add the alternate form for localhost/127.0.0.1
	if host == "localhost" {
		variants = append(variants, net.JoinHostPort("127.0.0.1", port))
	} else if host == "127.0.0.1" {
		variants = append(variants, net.JoinHostPort("localhost", port))
	}
	
	return variants
}

// LockManager provides access to the SQLite locks database
type LockManager struct {
	dbPath string
	db     *sql.DB
}

// NewLockManager creates a new lock manager
func NewLockManager(clineDir string) (*LockManager, error) {
	dbPath := filepath.Join(clineDir, common.SETTINGS_SUBFOLDER, "locks.db")

	// Ensure the directory exists (for future DB creation by cline-core)
	dbDir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dbDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create database directory: %w", err)
	}

	// Check if database exists
	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		// Database doesn't exist - return manager with nil db
		// All methods already handle this gracefully!
		return &LockManager{dbPath: dbPath, db: nil}, nil
	}

	// Database exists - open it normally (no schema creation)
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		// If we can't open existing database, return nil db manager
		return &LockManager{dbPath: dbPath, db: nil}, nil
	}

	// Test the connection
	if err := db.Ping(); err != nil {
		db.Close()
		// If connection fails, return nil db manager
		return &LockManager{dbPath: dbPath, db: nil}, nil
	}

	return &LockManager{
		dbPath: dbPath,
		db:     db,
	}, nil
}

// ensureConnection attempts to establish a database connection if one doesn't exist
func (lm *LockManager) ensureConnection() error {
	// If we already have a connection, we're done
	if lm.db != nil {
		return nil
	}

	// Check if database exists now (created by cline-core)
	if _, err := os.Stat(lm.dbPath); os.IsNotExist(err) {
		return fmt.Errorf("database not available")
	}

	// Database exists, try to connect
	db, err := sql.Open("sqlite", lm.dbPath)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}

	if err := db.Ping(); err != nil {
		db.Close()
		return fmt.Errorf("database connection failed: %w", err)
	}

	// Success! Update our connection permanently
	lm.db = db
	return nil
}

// Close closes the database connection
func (lm *LockManager) Close() error {
	if lm.db != nil {
		return lm.db.Close()
	}
	return nil
}

// GetInstanceLocks returns all instance locks
func (lm *LockManager) GetInstanceLocks() ([]common.LockRow, error) {
	if err := lm.ensureConnection(); err != nil {
		return []common.LockRow{}, nil
	}

	query := common.SelectInstanceLocksSQL

	rows, err := lm.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to query instance locks: %w", err)
	}
	defer rows.Close()

	var locks []common.LockRow
	for rows.Next() {
		var lock common.LockRow
		err := rows.Scan(&lock.ID, &lock.HeldBy, &lock.LockType, &lock.LockTarget, &lock.LockedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan lock row: %w", err)
		}
		locks = append(locks, lock)
	}

	return locks, nil
}

// RemoveInstanceLock removes an instance lock by address
func (lm *LockManager) RemoveInstanceLock(address string) error {
	if err := lm.ensureConnection(); err != nil {
		return nil // Gracefully handle missing database for cleanup operations
	}

	query := common.DeleteInstanceLockSQL
	_, err := lm.db.Exec(query, address)
	if err != nil {
		return fmt.Errorf("failed to remove instance lock: %w", err)
	}

	return nil
}

// HasInstanceAtAddress checks if an instance exists at the given address
func (lm *LockManager) HasInstanceAtAddress(address string) (bool, error) {
	if err := lm.ensureConnection(); err != nil {
		return false, err
	}

	query := common.CountInstanceLockSQL
	var count int
	err := lm.db.QueryRow(query, address).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("failed to check instance existence: %w", err)
	}

	return count > 0, nil
}

// GetInstanceInfo returns instance information directly from SQLite.
// Handles localhost/127.0.0.1 equivalence by trying both variants.
func (lm *LockManager) GetInstanceInfo(address string) (*common.CoreInstanceInfo, error) {
	if err := lm.ensureConnection(); err != nil {
		return nil, err
	}

	query := common.SelectInstanceLockByHolderSQL
	variants := normalizeAddressVariants(address)
	
	var heldBy, lockTarget string
	var lockedAt int64
	var lastErr error

	// Try each address variant (e.g., localhost:50607 and 127.0.0.1:50607)
	for _, variant := range variants {
		err := lm.db.QueryRow(query, variant).Scan(&heldBy, &lockTarget, &lockedAt)
		if err == nil {
			// Found it!
			return &common.CoreInstanceInfo{
				Address:            heldBy,
				HostServiceAddress: lockTarget,
				Status:             grpc_health_v1.HealthCheckResponse_UNKNOWN,
				LastSeen:           time.Unix(lockedAt/1000, 0),
			}, nil
		}
		if err != sql.ErrNoRows {
			// Real error (not just "not found"), save it
			lastErr = err
		}
	}
	
	// None of the variants were found
	if lastErr != nil {
		return nil, fmt.Errorf("failed to query instance: %w", lastErr)
	}
	return nil, fmt.Errorf("instance %s not found", address)
}

// ListInstancesWithHealthCheck returns all instances with real-time health checks
func (lm *LockManager) ListInstancesWithHealthCheck(ctx context.Context) ([]*common.CoreInstanceInfo, error) {
	if err := lm.ensureConnection(); err != nil {
		return []*common.CoreInstanceInfo{}, nil
	}

	// Get all instance locks
	locks, err := lm.GetInstanceLocks()
	if err != nil {
		return nil, fmt.Errorf("failed to get instance locks: %w", err)
	}

	var instances []*common.CoreInstanceInfo

	for _, lock := range locks {
		// Create instance info using actual SQLite data
		status, err := common.PerformHealthCheck(ctx, lock.HeldBy)
		if status != grpc_health_v1.HealthCheckResponse_SERVING || err != nil {
			time.Sleep(1 * time.Second)
			status, err = common.PerformHealthCheck(ctx, lock.HeldBy)
		}

		info := &common.CoreInstanceInfo{
			Address:            lock.HeldBy,
			HostServiceAddress: lock.LockTarget,
			Status:             status,
			LastSeen:           time.Unix(lock.LockedAt/1000, 0),
		}

		instances = append(instances, info)
	}

	return instances, nil
}

// GetDefaultInstance reads the default instance from the settings file
func GetDefaultInstance(clineDir string) (string, error) {
	settingsPath := filepath.Join(clineDir, common.SETTINGS_SUBFOLDER, "settings", "cli-default-instance.json")

	data, err := os.ReadFile(settingsPath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", fmt.Errorf("failed to read default instance file: %w", err)
	}

	var defaultInstance common.DefaultCoreInstance
	if err := json.Unmarshal(data, &defaultInstance); err != nil {
		return "", fmt.Errorf("failed to parse default instance JSON: %w", err)
	}

	if defaultInstance.Address == "" {
		return "", fmt.Errorf("default instance not set in settings file")
	}

	return defaultInstance.Address, nil
}

// SetDefaultInstance writes the default instance to the settings file with proper locking
func SetDefaultInstance(clineDir, address string) error {
	// Create lock manager for this operation
	lockManager, err := NewLockManager(clineDir)
	if err != nil {
		return fmt.Errorf("Warning: SQLite unavailable, writing without lock: %v\n", err)
	}
	defer lockManager.Close()

	settingsPath := filepath.Join(clineDir, common.SETTINGS_SUBFOLDER, "settings", "cli-default-instance.json")

	// Generate a unique identifier for this CLI process
	heldBy := fmt.Sprintf("cli-process-%d", os.Getpid())

	// Use file lock for the write operation
	return lockManager.WithFileLock(settingsPath, heldBy, func() error {
		return writeDefaultInstanceJSONToDisk(clineDir, address)
	})
}

func writeDefaultInstanceJSONToDisk(clineDir, address string) error {
	settingsDir := filepath.Join(clineDir, common.SETTINGS_SUBFOLDER, "settings")
	if err := os.MkdirAll(settingsDir, 0755); err != nil {
		return fmt.Errorf("failed to create settings directory: %w", err)
	}

	settingsPath := filepath.Join(settingsDir, "cli-default-instance.json")

	payload := common.DefaultCoreInstance{
		Address:     address,
		LastUpdated: time.Now().Format(time.RFC3339),
	}

	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal default instance JSON: %w", err)
	}

	if err := os.WriteFile(settingsPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write default instance file: %w", err)
	}

	return nil
}

// AcquireFileLock attempts to acquire a file lock
func (lm *LockManager) AcquireFileLock(filePath, heldBy string) error {
	if err := lm.ensureConnection(); err != nil {
		return err
	}

	now := time.Now().Unix() * 1000 // Convert to milliseconds

	query := common.InsertFileLockSQL

	_, err := lm.db.Exec(query, heldBy, filePath, now)
	if err != nil {
		return fmt.Errorf("failed to acquire file lock for %s: %w", filePath, err)
	}

	return nil
}

// ReleaseFileLock releases a file lock
func (lm *LockManager) ReleaseFileLock(filePath, heldBy string) error {
	if lm.db == nil {
		return nil
	}

	query := common.DeleteFileLockSQL

	_, err := lm.db.Exec(query, heldBy, filePath)
	if err != nil {
		return fmt.Errorf("failed to release file lock for %s: %w", filePath, err)
	}

	return nil
}

// WithFileLock executes a function while holding a file lock
func (lm *LockManager) WithFileLock(filePath, heldBy string, fn func() error) error {
	if err := lm.AcquireFileLock(filePath, heldBy); err != nil {
		return err
	}

	defer func() {
		if releaseErr := lm.ReleaseFileLock(filePath, heldBy); releaseErr != nil {
			fmt.Printf("Warning: Failed to release file lock for %s: %v\n", filePath, releaseErr)
		}
	}()

	return fn()
}
