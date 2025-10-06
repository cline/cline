export type LockType = "file" | "instance" | "folder"

export interface LockRow {
	id: number
	held_by: string
	lock_type: LockType
	lock_target: string // varies by type: file path, host address, or folder path
	locked_at: number
}

export interface SqliteLockManagerOptions {
	dbPath: string
	instanceAddress: string // cline core address
}
