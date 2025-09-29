export type LockType = "file" | "instance" | "folder"

export type LockStatus = "starting" | "healthy" | "unhealthy"

export interface LockRow {
	id: number
	held_by: string // address:port of instance holding the lock
	lock_type: LockType
	lock_target: string // varies by type: file path, host address, or folder path
	locked_at: number // timestamp when lock was acquired
}

export interface InstanceLockData {
	address: string
	core_port: number
	host_port: number
	status: LockStatus
	last_seen: string
	process_pid: number
	version?: string
	created_at: string
	metadata?: Record<string, any>
}

export interface SqliteLockManagerOptions {
	dbPath: string
	instanceAddress: string // host:port format
}
