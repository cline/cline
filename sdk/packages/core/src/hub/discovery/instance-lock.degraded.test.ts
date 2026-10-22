import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const { loadSqliteDb } = vi.hoisted(() => ({
	loadSqliteDb: vi.fn<(path: string) => unknown>(() => {
		throw new Error("SQLite is unavailable in this runtime");
	}),
}));

// Simulates runtimes with a broken or missing SQLite backend (e.g.
// node:sqlite unavailable) without touching a real database.
vi.mock("@cline/shared/db", () => ({ loadSqliteDb }));

import {
	HubInstanceLock,
	HubLockHeldError,
	resolveHubInstanceLockPath,
} from "./instance-lock";

describe("HubInstanceLock without a usable SQLite backend", () => {
	function tempLockFile(): string {
		return resolveHubInstanceLockPath(
			join(mkdtempSync(join(tmpdir(), "cline-hub-lock-")), "discovery.json"),
		);
	}

	it("degrades to an unheld lock when the lock database cannot be loaded", () => {
		loadSqliteDb.mockImplementationOnce(() => {
			throw new Error("SQLite is unavailable in this runtime");
		});
		const lockFile = tempLockFile();
		const lock = HubInstanceLock.acquire(lockFile);
		expect(lock.held).toBe(false);
		expect(lock.lockFile).toBe(lockFile);
		expect(() => lock.release()).not.toThrow();
	});

	it("degrades on a non-busy failure instead of propagating it", () => {
		const close = vi.fn();
		loadSqliteDb.mockImplementationOnce(() => ({
			exec: (sql: string) => {
				if (sql.includes("BEGIN EXCLUSIVE")) {
					throw new Error("SQLITE_IOERR: disk I/O error");
				}
			},
			prepare: vi.fn(),
			close,
		}));
		const lock = HubInstanceLock.acquire(tempLockFile());
		expect(lock.held).toBe(false);
		expect(close).toHaveBeenCalled();
	});

	it("still surfaces a held lock as HubLockHeldError", () => {
		loadSqliteDb.mockImplementationOnce(() => ({
			exec: (sql: string) => {
				if (sql.includes("BEGIN EXCLUSIVE")) {
					throw Object.assign(new Error("database is locked"), {
						code: "SQLITE_BUSY",
					});
				}
			},
			prepare: vi.fn(),
			close: vi.fn(),
		}));
		expect(() => HubInstanceLock.acquire(tempLockFile())).toThrow(
			HubLockHeldError,
		);
	});
});
