package common

// Database query constants for the SQLite locks database
const (

	// SelectInstanceLocksSQL selects all instance locks ordered by creation time
	SelectInstanceLocksSQL = `
		SELECT id, held_by, lock_type, lock_target, locked_at 
		FROM locks 
		WHERE lock_type = 'instance' 
		ORDER BY locked_at ASC
	`

	SelectInstanceLockByHolderSQL = `
		SELECT held_by, lock_target, locked_at 
		FROM locks 
		WHERE held_by = ? AND lock_type = 'instance'
	`
	SelectInstanceLockHoldersAscSQL = `
		SELECT held_by, lock_target, locked_at 
		FROM locks 
		WHERE lock_type = 'instance' 
		ORDER BY locked_at ASC
	`

	// DeleteInstanceLockSQL deletes an instance lock by address
	DeleteInstanceLockSQL = `
		DELETE FROM locks 
		WHERE held_by = ? AND lock_type = 'instance'
	`

	InsertFileLockSQL = `
		INSERT INTO locks (held_by, lock_type, lock_target, locked_at)
		VALUES (?, 'file', ?, ?)
	`

	// DeleteFileLockSQL deletes a file lock by holder and target
	DeleteFileLockSQL = `
		DELETE FROM locks 
		WHERE held_by = ? AND lock_type = 'file' AND lock_target = ?
		`

	// CountInstanceLockSQL counts instance locks for a given address
	CountInstanceLockSQL = `
		SELECT COUNT(*) FROM locks 
		WHERE held_by = ? AND lock_type = 'instance'
	`

	// InsertInstanceLockSQL inserts or replaces an instance lock
	InsertInstanceLockSQL = `
		INSERT OR REPLACE INTO locks (held_by, lock_type, lock_target, locked_at)
		VALUES (?, 'instance', ?, ?)
	`
)
