/**
 * OS-backed exclusive Hub instance lock.
 *
 * Authority over a Hub owner context (the discovery path) is an
 * operating-system exclusive lock, not a PID file, not a heartbeat, and not
 * build arbitration: the lock is a SQLite database held inside a
 * never-committed `BEGIN EXCLUSIVE` transaction, which SQLite maps onto OS
 * file locks. The kernel releases the lock the instant the holding process
 * dies — crashed holders cannot leak ownership, and a live holder cannot be
 * displaced by deleting a file.
 *
 * A process that fails to acquire the lock must connect to the running Hub
 * or diagnose — never kill it and never bind another endpoint on its own.
 * This makes the historical mutual-retire loop (two installs SIGTERMing each
 * other's daemon, #13145/#13230) structurally impossible: at most one live
 * Hub can exist per owner context, enforced by the OS before either process
 * gets a chance to disagree.
 *
 * The startup-lock directory (`<discoveryPath>.lock`, see `withHubLock`)
 * remains a short-lived mutex around discovery reads/writes; this lock is a
 * different thing — it is held for the entire lifetime of the serving Hub.
 */

import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadSqliteDb, type SqliteDb } from "@cline/shared/db";

/** Exit code for a daemon that lost the singleton race: diagnose, never replace. */
export const HUB_LOCK_HELD_EXIT_CODE = 3;

/** The lock is held by another live Hub process (or connection). */
export class HubLockHeldError extends Error {
	readonly lockFile: string;

	constructor(lockFile: string) {
		super(
			`Hub instance lock is held by a live Hub: ${lockFile}. ` +
				"Connect to the running Hub or diagnose it; never replace it.",
		);
		this.name = "HubLockHeldError";
		this.lockFile = lockFile;
	}
}

export function isHubLockHeldError(error: unknown): error is HubLockHeldError {
	return error instanceof Error && error.name === "HubLockHeldError";
}

/** The lock file that guards one owner context (derived from its discovery path). */
export function resolveHubInstanceLockPath(discoveryPath: string): string {
	return `${discoveryPath}.instance.lock`;
}

export class HubInstanceLock {
	private db: SqliteDb | undefined;
	readonly lockFile: string;

	private constructor(lockFile: string, db: SqliteDb | undefined) {
		this.lockFile = lockFile;
		this.db = db;
	}

	get held(): boolean {
		return this.db !== undefined;
	}

	/** Release the lock (process exit releases it too, via the OS). */
	release(): void {
		const db = this.db;
		if (!db) {
			return;
		}
		this.db = undefined;
		try {
			db.exec("ROLLBACK;");
		} catch {
			// Already rolled back or the handle is gone; closing suffices.
		}
		db.close?.();
	}

	/**
	 * Attempt to take exclusive ownership of a Hub owner context. Throws
	 * `HubLockHeldError` when another live process holds it.
	 *
	 * Only a positively held lock (SQLITE_BUSY/LOCKED) refuses startup. Any
	 * other failure — SQLite unavailable in this runtime, an unwritable lock
	 * directory — degrades to an unheld lock (`held === false`) and the Hub
	 * starts without singleton enforcement, matching how the event log and
	 * run queue already degrade rather than making SQLite a hard requirement.
	 */
	static acquire(lockFile: string): HubInstanceLock {
		let existed = false;
		let db: SqliteDb;
		try {
			mkdirSync(dirname(lockFile), { recursive: true });
			existed = existsSync(lockFile);
			db = loadSqliteDb(lockFile);
		} catch {
			return new HubInstanceLock(lockFile, undefined);
		}
		try {
			// Fail immediately instead of queueing behind the current holder.
			db.exec("PRAGMA busy_timeout = 0;");
			db.exec("BEGIN EXCLUSIVE;");
		} catch (error) {
			db.close?.();
			if (isBusy(error)) {
				throw new HubLockHeldError(lockFile);
			}
			return new HubInstanceLock(lockFile, undefined);
		}
		if (!existed) {
			try {
				chmodSync(lockFile, 0o600);
			} catch {
				// Permission tightening is best-effort on exotic filesystems.
			}
		}
		return new HubInstanceLock(lockFile, db);
	}
}

function isBusy(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	const code = (error as { code?: unknown })?.code;
	return (
		code === "SQLITE_BUSY" ||
		code === "SQLITE_LOCKED" ||
		message.includes("SQLITE_BUSY") ||
		message.includes("SQLITE_LOCKED") ||
		message.includes("database is locked")
	);
}
