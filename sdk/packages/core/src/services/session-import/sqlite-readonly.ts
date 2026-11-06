import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { SqliteDb, SqliteStatement } from "@cline/shared/db";

export type ReadOnlySqliteMode = "immutable" | "wal-reader";

export interface ReadOnlySqlite {
	db: SqliteDb;
	mode: ReadOnlySqliteMode;
	close(): void;
}

const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_READONLY = 8;
const SQLITE_CORRUPT = 11;
const SQLITE_CANTOPEN = 14;
const SQLITE_NOTADB = 26;

export function sqliteErrorCode(error: unknown): number | undefined {
	if (!error || typeof error !== "object") return undefined;
	const record = error as {
		errcode?: unknown;
		errno?: unknown;
		code?: unknown;
	};
	const numeric =
		typeof record.errcode === "number"
			? record.errcode
			: typeof record.errno === "number"
				? record.errno
				: undefined;
	if (numeric !== undefined) return numeric & 0xff;
	const message = `${record.code ?? ""} ${(error as Error).message ?? ""}`;
	if (/CANTOPEN|unable to open/i.test(message)) return SQLITE_CANTOPEN;
	if (/NOTADB|not a database/i.test(message)) return SQLITE_NOTADB;
	if (/CORRUPT|malformed/i.test(message)) return SQLITE_CORRUPT;
	if (/READONLY|readonly database/i.test(message)) return SQLITE_READONLY;
	if (/BUSY|LOCKED|locked/i.test(message)) return SQLITE_BUSY;
	return undefined;
}

export function isTornReadError(error: unknown): boolean {
	const code = sqliteErrorCode(error);
	return code === SQLITE_CORRUPT || code === SQLITE_NOTADB;
}

function sleepMs(ms: number): void {
	try {
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
	} catch {
		/* ignore */
	}
}

type RawDb = {
	prepare: (sql: string) => SqliteStatement;
	exec: (sql: string) => void;
	close: () => void;
};

function openRaw(filename: string): RawDb {
	const require = createRequire(import.meta.url);
	if (typeof (globalThis as { Bun?: unknown }).Bun !== "undefined") {
		const { Database } = require("bun:sqlite") as {
			Database: new (
				path: string,
				options?: { readonly?: boolean },
			) => {
				query: (sql: string) => SqliteStatement;
				exec: (sql: string) => void;
				close: () => void;
			};
		};
		const db = new Database(filename, { readonly: true });
		return {
			prepare: (sql) => db.query(sql),
			exec: (sql) => db.exec(sql),
			close: () => db.close(),
		};
	}

	const originalEmit = process.emitWarning;
	process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
		const msg =
			typeof warning === "string" ? warning : (warning?.message ?? "");
		if (!msg.includes("SQLite"))
			(originalEmit as (...args: unknown[]) => void).call(
				process,
				warning,
				...args,
			);
	}) as typeof process.emitWarning;
	try {
		type NodeDb = {
			prepare: (sql: string) => SqliteStatement;
			exec: (sql: string) => void;
			close: () => void;
		};
		const sqlite = require(["node", ":sqlite"].join("")) as {
			Database?: new (path: string, options?: { readOnly?: boolean }) => NodeDb;
			DatabaseSync: new (
				path: string,
				options?: { readOnly?: boolean },
			) => NodeDb;
		};
		const Database = sqlite.Database ?? sqlite.DatabaseSync;
		const db = new Database(filename, { readOnly: true });
		return {
			prepare: (sql) => {
				const stmt = db.prepare(sql);
				return {
					run: (...params) => stmt.run(...params),
					get: (...params) => stmt.get(...params) ?? null,
					all: (...params) => stmt.all(...params),
				};
			},
			exec: (sql) => db.exec(sql),
			close: () => db.close(),
		};
	} finally {
		process.emitWarning = originalEmit;
	}
}

function openProbed(filename: string, pragmas: string[]): RawDb {
	for (let attempt = 0; ; attempt++) {
		let db: RawDb | undefined;
		try {
			db = openRaw(filename);
			for (const pragma of pragmas) db.exec(pragma);
			db.prepare("SELECT 1 FROM sqlite_master LIMIT 1").get();
			return db;
		} catch (error) {
			db?.close();
			const code = sqliteErrorCode(error);
			if ((code === SQLITE_BUSY || code === SQLITE_LOCKED) && attempt < 3) {
				sleepMs(50 * 2 ** attempt);
				continue;
			}
			throw error;
		}
	}
}

/**
 * Builds a SQLite `file:` URI. UNC paths (`\\server\share\…`) get an empty
 * authority (`file:////server/share/…`) because SQLite rejects URI authorities.
 */
export function sqliteFileUri(url: URL, query: string): string {
	const href = url.host ? `file:////${url.host}${url.pathname}` : url.href;
	return `${href}?${query}`;
}

const fileUri = (path: string, query: string) =>
	sqliteFileUri(pathToFileURL(path), query);

export const READ_ONLY_UNAVAILABLE_MESSAGE =
	"Database is busy or in an unexpected state; close the app that owns it and try again";

/**
 * Opens a SQLite database that another process may own, without ever writing
 * next to it:
 * - no `-wal`: `immutable=1` (no locks, no side files);
 * - `-wal` and `-shm` present (owner running): a plain read-only WAL reader,
 *   which only takes read-marks in the existing `-shm`;
 * - anything else (`-wal` without `-shm`, or a database that stays unreadable)
 *   fails instead of opening in a mode that could create `-wal`/`-shm`.
 */
export function openSqliteReadOnly(dbPath: string): ReadOnlySqlite {
	if (!existsSync(dbPath)) throw new Error("Database file not found");
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt++) {
		const hasWal = existsSync(`${dbPath}-wal`);
		const hasShm = existsSync(`${dbPath}-shm`);
		if (!hasWal) {
			try {
				const raw = openProbed(fileUri(dbPath, "mode=ro&immutable=1"), []);
				return { db: raw, mode: "immutable", close: () => raw.close() };
			} catch (error) {
				// A torn read means the owner may be starting up; re-check the
				// side files before retrying. Never fall through to a plain open.
				if (!isTornReadError(error)) throw error;
				lastError = error;
				sleepMs(50 * 2 ** attempt);
				continue;
			}
		}
		if (!hasShm) break;
		try {
			const raw = openProbed(fileUri(dbPath, "mode=ro"), [
				"PRAGMA busy_timeout=2000",
				"PRAGMA query_only=1",
			]);
			return { db: raw, mode: "wal-reader", close: () => raw.close() };
		} catch (error) {
			const code = sqliteErrorCode(error);
			if (
				code !== SQLITE_CANTOPEN &&
				code !== SQLITE_READONLY &&
				code !== SQLITE_BUSY
			) {
				throw error;
			}
			lastError = error;
			break;
		}
	}
	throw new Error(READ_ONLY_UNAVAILABLE_MESSAGE, { cause: lastError });
}

export function withReadSnapshot<T>(db: SqliteDb, fn: () => T): T {
	db.exec("BEGIN");
	try {
		return fn();
	} finally {
		try {
			db.exec("COMMIT");
		} catch {
			// Release the read transaction (and its WAL read-mark) either way.
			try {
				db.exec("ROLLBACK");
			} catch {
				/* already closed */
			}
		}
	}
}
