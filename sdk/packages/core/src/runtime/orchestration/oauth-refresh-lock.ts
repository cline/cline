import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { loadSqliteDb } from "@cline/shared/db";

/**
 * Serialize refresh/read/save across managers and processes sharing credentials.
 * SQLite uses OS file locks, released even when a holder crashes. The lock file
 * contains no credentials and must not be removed while processes are running.
 */
export async function withOAuthRefreshLock<T>(
	settingsPath: string,
	storageProviderId: string,
	run: () => Promise<T>,
): Promise<T> {
	const providerKey = createHash("sha256")
		.update(storageProviderId)
		.digest("hex");
	const db = loadSqliteDb(`${resolve(settingsPath)}.oauth-${providerKey}.lock`);
	let acquired = false;
	const deadline = Date.now() + 60_000;
	try {
		// Never block this process's event loop while its other manager owns
		// the lock: that manager may be waiting for an HTTP response.
		db.exec("PRAGMA busy_timeout = 0;");
		while (!acquired) {
			try {
				db.exec("BEGIN EXCLUSIVE;");
				acquired = true;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const code = (error as { code?: unknown })?.code;
				const busy =
					code === "SQLITE_BUSY" ||
					code === "SQLITE_LOCKED" ||
					/SQLITE_BUSY|SQLITE_LOCKED|database is locked/.test(message);
				if (!busy) throw error;
				if (Date.now() >= deadline) {
					throw new Error(
						"Timed out waiting for another process to refresh OAuth credentials.",
					);
				}
				await setTimeout(25);
			}
		}
		return await run();
	} finally {
		try {
			if (acquired) db.exec("ROLLBACK;");
		} finally {
			db.close?.();
		}
	}
}
