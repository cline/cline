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

export interface FolderLockOptions {
	lockTarget: string // The cwdHash of the folder to lock
	heldBy: string // taskId of the locking task
}

export interface FolderLockResult {
	acquired: boolean // success or failure
	conflictingLock?: LockRow // conflicting lock if available
}

export interface FolderLockWithRetryResult {
	acquired: boolean // success or failure
	skipped?: boolean // lock attempt was skipped (VS Code expected behavior)
	conflictingLock?: LockRow // conflicting lock if available
}
