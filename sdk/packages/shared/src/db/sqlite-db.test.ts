import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	ensureSessionSchema,
	isSqliteBusyError,
	loadSqliteDb,
	withSqliteBusyRetry,
} from "./sqlite-db";

const require = createRequire(import.meta.url);
const sqliteAvailable = (() => {
	try {
		require("node:sqlite");
		return true;
	} catch {
		return false;
	}
})();

describe("isSqliteBusyError", () => {
	it("detects busy and locked sqlite errors by code", () => {
		expect(isSqliteBusyError({ code: "SQLITE_BUSY" })).toBe(true);
		expect(isSqliteBusyError({ code: "SQLITE_LOCKED" })).toBe(true);
	});

	it("detects busy and locked sqlite errors by message", () => {
		expect(
			isSqliteBusyError(new Error("SQLITE_BUSY: database is locked")),
		).toBe(true);
		expect(isSqliteBusyError(new Error("database is locked"))).toBe(true);
	});

	it("does not match unrelated errors", () => {
		expect(isSqliteBusyError(new Error("something else"))).toBe(false);
		expect(isSqliteBusyError(undefined)).toBe(false);
	});
});

describe("withSqliteBusyRetry", () => {
	it("retries transient sqlite busy failures and returns the eventual value", () => {
		let attempts = 0;

		const result = withSqliteBusyRetry(() => {
			attempts += 1;
			if (attempts < 3) {
				throw new Error("SQLITE_BUSY: database is locked");
			}
			return "ok";
		});

		expect(result).toBe("ok");
		expect(attempts).toBe(3);
	});

	it("rethrows non-sqlite errors immediately", () => {
		expect(() =>
			withSqliteBusyRetry(() => {
				throw new Error("boom");
			}),
		).toThrow("boom");
	});

	it("stops retrying after the retry budget is exhausted", () => {
		let attempts = 0;

		expect(() =>
			withSqliteBusyRetry(() => {
				attempts += 1;
				throw new Error("SQLITE_BUSY: database is locked");
			}),
		).toThrow("SQLITE_BUSY");
		expect(attempts).toBe(4);
	});
});

describe("ensureSessionSchema", () => {
	const sqliteIt = sqliteAvailable ? it : it.skip;

	sqliteIt(
		"adds transcript_path back to legacy sessions tables when missing",
		() => {
			const dir = mkdtempSync(join(tmpdir(), "sqlite-schema-migrate-"));
			try {
				const db = loadSqliteDb(join(dir, "sessions.db"));
				db.exec(`CREATE TABLE sessions (
				session_id TEXT PRIMARY KEY,
				source TEXT NOT NULL,
				pid INTEGER NOT NULL,
				started_at TEXT NOT NULL,
				ended_at TEXT,
				exit_code INTEGER,
				status TEXT NOT NULL,
				status_lock INTEGER NOT NULL DEFAULT 0,
				interactive INTEGER NOT NULL,
				provider TEXT NOT NULL,
				model TEXT NOT NULL,
				cwd TEXT NOT NULL,
				workspace_root TEXT NOT NULL,
				team_name TEXT,
				enable_tools INTEGER NOT NULL,
				enable_spawn INTEGER NOT NULL,
				enable_teams INTEGER NOT NULL,
				parent_session_id TEXT,
				parent_agent_id TEXT,
				agent_id TEXT,
				conversation_id TEXT,
				is_subagent INTEGER NOT NULL DEFAULT 0,
				prompt TEXT,
				metadata_json TEXT,
				hook_path TEXT NOT NULL,
				messages_path TEXT,
				updated_at TEXT NOT NULL
			);`);
				db.exec(`INSERT INTO sessions (
				session_id, source, pid, started_at, ended_at, exit_code, status, status_lock, interactive,
				provider, model, cwd, workspace_root, team_name, enable_tools, enable_spawn, enable_teams,
				parent_session_id, parent_agent_id, agent_id, conversation_id, is_subagent, prompt,
				metadata_json, hook_path, messages_path, updated_at
			) VALUES (
				'session-1', 'cli', 1, '2026-04-21T00:00:00.000Z', NULL, NULL, 'running', 0, 0,
				'anthropic', 'claude', '/tmp', '/tmp', NULL, 1, 0, 0,
				NULL, NULL, NULL, NULL, 0, 'hello',
				NULL, '', '/tmp/session-1.messages.json', '2026-04-21T00:00:00.000Z'
			);`);

				ensureSessionSchema(db, { includeLegacyMigrations: true });

				const columns = db
					.prepare("PRAGMA table_info(sessions);")
					.all()
					.map((column) => String(column.name));
				expect(columns).toContain("transcript_path");
				expect(columns).toContain("messages_path");

				const row = db
					.prepare(
						"SELECT session_id, prompt, transcript_path, messages_path FROM sessions WHERE session_id = ?",
					)
					.get("session-1");
				expect(row).toMatchObject({
					session_id: "session-1",
					prompt: "hello",
					transcript_path: "",
					messages_path: "/tmp/session-1.messages.json",
				});
				db.close?.();
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);
});
