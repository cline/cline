type LockType = "file" | "instance" | "folder"

export interface LockRow {
	id: number
	held_by: string
	lock_type: LockType
	lock_target: string // varies by type: file path, host address, or folder path
	locked_at: number
}

export interface SqliteLockManagerOptions {
	dbPath: string
	// Opaque identity that owns this instance's rows (held_by). A spawned core
	// uses its per-spawn instance ID; the CLI-harness core uses its listener
	// address. No query may interpret it as an address.
	instanceOwner: string
}
