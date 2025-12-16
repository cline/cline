package e2e

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/cline/cli/pkg/common"
	_ "github.com/glebarez/go-sqlite"
	"google.golang.org/grpc/health/grpc_health_v1"
)

// readInstancesFromSQLite reads instances directly from the SQLite database for testing
func readInstancesFromSQLite(t *testing.T, clineDir string) []common.CoreInstanceInfo {
	t.Helper()

	dbPath := filepath.Join(clineDir, common.SETTINGS_SUBFOLDER, "locks.db")

	// Check if database exists
	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		return []common.CoreInstanceInfo{}
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Logf("Warning: Failed to open SQLite database: %v", err)
		return []common.CoreInstanceInfo{}
	}
	defer db.Close()

	// Query instance locks
	query := common.SelectInstanceLockHoldersAscSQL

	rows, err := db.Query(query)
	if err != nil {
		t.Logf("Warning: Failed to query instance locks: %v", err)
		return []common.CoreInstanceInfo{}
	}
	defer rows.Close()

	var instances []common.CoreInstanceInfo
	for rows.Next() {
		var heldBy, lockTarget string
		var lockedAt int64

		err := rows.Scan(&heldBy, &lockTarget, &lockedAt)
		if err != nil {
			t.Logf("Warning: Failed to scan lock row: %v", err)
			continue
		}

		// Create InstanceInfo
		info := common.CoreInstanceInfo{
			Address:            heldBy,
			HostServiceAddress: lockTarget,
			Status:             grpc_health_v1.HealthCheckResponse_UNKNOWN, // Will be updated by health check
			LastSeen:           time.Unix(lockedAt/1000, 0),                // Convert from milliseconds
		}

		instances = append(instances, info)
	}

	return instances
}

// readDefaultInstanceFromSettings reads the default instance from the settings file
func readDefaultInstanceFromSettings(t *testing.T, clineDir string) string {
	t.Helper()

	settingsPath := filepath.Join(clineDir, common.SETTINGS_SUBFOLDER, "settings", "cli-default-instance.json")

	data, err := os.ReadFile(settingsPath)
	if err != nil {
		if os.IsNotExist(err) {
			return ""
		}
		t.Logf("Warning: Failed to read default instance file: %v", err)
		return ""
	}

	var tmp struct {
		DefaultInstance string `json:"default_instance"`
	}
	if err := json.Unmarshal(data, &tmp); err != nil {
		t.Logf("Warning: Failed to parse default instance file: %v", err)
		return ""
	}

	return tmp.DefaultInstance
}

// insertRemoteInstanceIntoSQLite inserts a remote instance entry directly into SQLite for testing
func insertRemoteInstanceIntoSQLite(t *testing.T, dbPath, address string, corePort, hostPort int) error {
	t.Helper()

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return err
	}
	defer db.Close()

	// Initialize database schema for testing
	createTableSQL := `
		CREATE TABLE IF NOT EXISTS locks (
			id INTEGER PRIMARY KEY,
			held_by TEXT NOT NULL,
			lock_type TEXT NOT NULL CHECK (lock_type IN ('file', 'instance', 'folder')),
			lock_target TEXT NOT NULL,
			locked_at INTEGER NOT NULL,
			UNIQUE(lock_type, lock_target)
		);
	`
	createIndexesSQL := `
		CREATE INDEX IF NOT EXISTS idx_locks_held_by ON locks(held_by);
		CREATE INDEX IF NOT EXISTS idx_locks_type ON locks(lock_type);
		CREATE INDEX IF NOT EXISTS idx_locks_target ON locks(lock_target);
	`

	if _, err := db.Exec(createTableSQL); err != nil {
		return err
	}
	if _, err := db.Exec(createIndexesSQL); err != nil {
		return err
	}

	// Insert the remote instance
	hostAddress := "remote.example.com:0"
	if hostPort != 0 {
		hostAddress = "remote.example.com:" + strconv.Itoa(hostPort)
	}

	insertSQL := `INSERT INTO locks (held_by, lock_type, lock_target, locked_at) VALUES (?, 'instance', ?, ?)`
	_, err = db.Exec(insertSQL, address, hostAddress, time.Now().Unix()*1000)
	return err
}

// verifyInstanceExistsInSQLite checks if an instance exists in the SQLite database
func verifyInstanceExistsInSQLite(t *testing.T, dbPath, address string) bool {
	t.Helper()

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Logf("Failed to open database: %v", err)
		return false
	}
	defer db.Close()

	query := `SELECT COUNT(*) FROM locks WHERE held_by = ? AND lock_type = 'instance'`
	var count int
	err = db.QueryRow(query, address).Scan(&count)
	if err != nil {
		t.Logf("Failed to query database: %v", err)
		return false
	}

	return count > 0
}
