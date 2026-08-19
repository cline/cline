/**
 * OS-backed exclusive `gateway.lock` (Gateway RFC, Phase 3; ADR 0002).
 *
 * Authority over a data directory is an operating-system exclusive lock,
 * not a PID file and not a heartbeat: the lock is a SQLite database held
 * inside a never-committed `BEGIN EXCLUSIVE` transaction, which SQLite
 * maps onto OS file locks. The kernel releases the lock the instant the
 * holding process dies — crashed holders cannot leak ownership, and a
 * live holder cannot be displaced by deleting a file.
 *
 * A process that fails to acquire the lock must connect to the running
 * authority or diagnose — never kill it, never bind another port, never
 * pick a different data directory on its own (ADR 0003: no implicit
 * fallback).
 */

import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadSqliteDb, type SqliteDb } from "@cline/shared/db";

/** The lock is held by another live process (or connection). */
export class GatewayLockHeldError extends Error {
	readonly lockFile: string;

	constructor(lockFile: string) {
		super(
			`Gateway lock is held by a live authority: ${lockFile}. ` +
				"Connect to the running Gateway or diagnose it; never replace it.",
		);
		this.name = "GatewayLockHeldError";
		this.lockFile = lockFile;
	}
}

export class GatewayLock {
	private db: SqliteDb | undefined;
	readonly lockFile: string;

	private constructor(lockFile: string, db: SqliteDb) {
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
	 * Attempt to take exclusive ownership of a data directory. Throws
	 * `GatewayLockHeldError` when another live process holds it.
	 */
	static acquire(lockFile: string): GatewayLock {
		mkdirSync(dirname(lockFile), { recursive: true, mode: 0o700 });
		const existed = existsSync(lockFile);
		const db = loadSqliteDb(lockFile);
		try {
			// Fail immediately instead of queueing behind the current holder.
			db.exec("PRAGMA busy_timeout = 0;");
			db.exec("BEGIN EXCLUSIVE;");
		} catch (error) {
			db.close?.();
			if (isBusy(error)) {
				throw new GatewayLockHeldError(lockFile);
			}
			throw error;
		}
		if (!existed) {
			try {
				chmodSync(lockFile, 0o600);
			} catch {
				// Permission tightening is best-effort on exotic filesystems.
			}
		}
		return new GatewayLock(lockFile, db);
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
