import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSqliteDb } from "@cline/shared/db";
import type { SessionRecord } from "../../types/sessions";
import { SqliteSessionStore } from "./sqlite-session-store";

function makeSessionRecord(
	overrides: Partial<SessionRecord> & { sessionId: string },
): SessionRecord {
	return {
		sessionId: overrides.sessionId,
		source: overrides.source ?? "cli",
		pid: overrides.pid ?? 1234,
		startedAt: overrides.startedAt ?? new Date().toISOString(),
		endedAt: overrides.endedAt ?? null,
		exitCode: overrides.exitCode ?? null,
		status: overrides.status ?? "running",
		interactive: overrides.interactive ?? true,
		provider: overrides.provider ?? "anthropic",
		model: overrides.model ?? "claude-3-7-sonnet",
		cwd: overrides.cwd ?? "/tmp/test",
		workspaceRoot: overrides.workspaceRoot ?? "/tmp/test",
		anchorWorkspacePath: overrides.anchorWorkspacePath,
		enableTools: overrides.enableTools ?? true,
		enableSpawn: overrides.enableSpawn ?? false,
		enableTeams: overrides.enableTeams ?? false,
		isSubagent: overrides.isSubagent ?? false,
		...overrides,
	};
}

describe("SqliteSessionStore", () => {
	let testDir: string;
	let store: SqliteSessionStore;

	beforeEach(() => {
		testDir = mkdtempSync(join(tmpdir(), "sqlite-session-store-test-"));
		store = new SqliteSessionStore({ sessionsDir: testDir });
		store.init();
	});

	afterEach(() => {
		store.close();
		rmSync(testDir, { recursive: true, force: true });
	});

	describe("create & get with anchorWorkspacePath", () => {
		it("stores and retrieves explicit anchorWorkspacePath", () => {
			const record = makeSessionRecord({
				sessionId: "sess_1",
				cwd: "/repo/apps/cli/src",
				workspaceRoot: "/repo/apps/cli",
				anchorWorkspacePath: "/repo/apps/cli",
			});

			store.create(record);
			const retrieved = store.get("sess_1");

			expect(retrieved).toBeDefined();
			expect(retrieved?.anchorWorkspacePath).toBe("/repo/apps/cli");
			expect(retrieved?.workspaceRoot).toBe("/repo/apps/cli");
			expect(retrieved?.cwd).toBe("/repo/apps/cli/src");
		});

		it("auto-resolves anchorWorkspacePath using hierarchical resolution if omitted", () => {
			// Create a directory tree with a .cline workspace
			const repoRoot = join(testDir, "monorepo");
			const appDir = join(repoRoot, "apps", "cli");
			mkdirSync(join(repoRoot, ".cline"), { recursive: true });
			mkdirSync(appDir, { recursive: true });

			const record = makeSessionRecord({
				sessionId: "sess_auto",
				cwd: appDir,
				workspaceRoot: appDir,
			});

			store.create(record);
			const retrieved = store.get("sess_auto");

			expect(retrieved).toBeDefined();
			// Since monorepo/.cline exists, hierarchical resolution anchors to repoRoot
			expect(retrieved?.anchorWorkspacePath).toBe(repoRoot);
		});

		it("falls back to workspaceRoot if no parent .cline exists", () => {
			const record = makeSessionRecord({
				sessionId: "sess_fallback",
				cwd: "/uninitialized/path",
				workspaceRoot: "/uninitialized/path",
			});

			store.create(record);
			const retrieved = store.get("sess_fallback");

			expect(retrieved).toBeDefined();
			expect(retrieved?.anchorWorkspacePath).toBe("/uninitialized/path");
		});
	});

	describe("update anchorWorkspacePath", () => {
		it("updates anchorWorkspacePath when specified", () => {
			const record = makeSessionRecord({
				sessionId: "sess_update",
				anchorWorkspacePath: "/initial/anchor",
			});
			store.create(record);

			store.update({
				sessionId: "sess_update",
				anchorWorkspacePath: "/updated/anchor",
			});

			const retrieved = store.get("sess_update");
			expect(retrieved?.anchorWorkspacePath).toBe("/updated/anchor");
		});
	});

	describe("scoped history querying (list and listHistory)", () => {
		beforeEach(() => {
			// Populate records across different workspaces
			const now = Date.now();
			store.create(
				makeSessionRecord({
					sessionId: "sess_monorepo_root",
					startedAt: new Date(now - 1000).toISOString(),
					anchorWorkspacePath: "/repo/monorepo",
					workspaceRoot: "/repo/monorepo",
				}),
			);
			store.create(
				makeSessionRecord({
					sessionId: "sess_app_cli",
					startedAt: new Date(now - 2000).toISOString(),
					anchorWorkspacePath: "/repo/monorepo/apps/cli",
					workspaceRoot: "/repo/monorepo/apps/cli",
				}),
			);
			store.create(
				makeSessionRecord({
					sessionId: "sess_app_web",
					startedAt: new Date(now - 3000).toISOString(),
					anchorWorkspacePath: "/repo/monorepo/apps/web",
					workspaceRoot: "/repo/monorepo/apps/web",
				}),
			);
			store.create(
				makeSessionRecord({
					sessionId: "sess_other_project",
					startedAt: new Date(now - 4000).toISOString(),
					anchorWorkspacePath: "/other/project",
					workspaceRoot: "/other/project",
				}),
			);
		});

		it("filters by current scope (exact anchor only)", () => {
			const results = store.listHistory({
				anchorPath: "/repo/monorepo/apps/cli",
				scope: "current",
			});

			expect(results.map((r) => r.sessionId)).toEqual(["sess_app_cli"]);
		});

		it("filters by hierarchical scope (ancestor + all sub-packages)", () => {
			const results = store.listHistory({
				anchorPath: "/repo/monorepo",
				scope: "hierarchical",
			});

			expect(results.map((r) => r.sessionId)).toEqual([
				"sess_monorepo_root",
				"sess_app_cli",
				"sess_app_web",
			]);
			expect(results.map((r) => r.sessionId)).not.toContain("sess_other_project");
		});

		it("returns all sessions when scope is 'all'", () => {
			const results = store.listHistory({
				anchorPath: "/repo/monorepo/apps/cli",
				scope: "all",
			});

			expect(results.map((r) => r.sessionId)).toEqual([
				"sess_monorepo_root",
				"sess_app_cli",
				"sess_app_web",
				"sess_other_project",
			]);
		});

		it("supports limit and offset pagination with scoping", () => {
			const page1 = store.listHistory({
				anchorPath: "/repo/monorepo",
				scope: "hierarchical",
				limit: 2,
				offset: 0,
			});
			expect(page1.map((r) => r.sessionId)).toEqual([
				"sess_monorepo_root",
				"sess_app_cli",
			]);

			const page2 = store.listHistory({
				anchorPath: "/repo/monorepo",
				scope: "hierarchical",
				limit: 2,
				offset: 2,
			});
			expect(page2.map((r) => r.sessionId)).toEqual(["sess_app_web"]);
		});

		it("supports list(options) overload signature", () => {
			const results = store.list({
				anchorPath: "/repo/monorepo/apps/cli",
				scope: "current",
			});
			expect(results.map((r) => r.sessionId)).toEqual(["sess_app_cli"]);
		});
	});

	describe("fallback querying for legacy rows without anchor_workspace_path", () => {
		it("falls back to workspaceRoot and cwd when anchor_workspace_path is NULL", () => {
			// Directly insert row with NULL anchor_workspace_path
			store.run(
				`INSERT INTO sessions (
					session_id, source, pid, started_at, status, interactive,
					provider, model, cwd, workspace_root, enable_tools, enable_spawn, enable_teams,
					is_subagent, hook_path, updated_at, anchor_workspace_path
				) VALUES (
					'sess_legacy_null', 'cli', 123, '2026-09-27T00:00:00.000Z', 'running', 1,
					'anthropic', 'claude', '/legacy/project/src', '/legacy/project', 1, 0, 0,
					0, '', '2026-09-27T00:00:00.000Z', NULL
				)`,
			);

			const currentResults = store.listHistory({
				anchorPath: "/legacy/project",
				scope: "current",
			});
			expect(currentResults.map((r) => r.sessionId)).toContain("sess_legacy_null");

			const hierarchicalResults = store.listHistory({
				anchorPath: "/legacy",
				scope: "hierarchical",
			});
			expect(hierarchicalResults.map((r) => r.sessionId)).toContain(
				"sess_legacy_null",
			);
		});
	});

	describe("backfillAnchorWorkspacePaths", () => {
		it("populates anchor_workspace_path on unpopulated rows and is idempotent", () => {
			// Create a directory with a workspace config
			const workspaceDir = join(testDir, "backfill-workspace");
			mkdirSync(join(workspaceDir, ".cline"), { recursive: true });

			store.run(
				`INSERT INTO sessions (
					session_id, source, pid, started_at, status, interactive,
					provider, model, cwd, workspace_root, enable_tools, enable_spawn, enable_teams,
					is_subagent, hook_path, updated_at, anchor_workspace_path
				) VALUES (
					'sess_needs_backfill', 'cli', 123, '2026-09-27T00:00:00.000Z', 'running', 1,
					'anthropic', 'claude', ?, ?, 1, 0, 0,
					0, '', '2026-09-27T00:00:00.000Z', NULL
				)`,
				[workspaceDir, workspaceDir],
			);

			const updated = store.backfillAnchorWorkspacePaths();
			expect(updated).toBe(1);

			const record = store.get("sess_needs_backfill");
			expect(record?.anchorWorkspacePath).toBe(workspaceDir);

			// Running second time updates 0
			expect(store.backfillAnchorWorkspacePaths()).toBe(0);
		});
	});

	describe("database migration & zero data loss", () => {
		it("migrates pre-existing sessions.db without anchor_workspace_path column", () => {
			const legacyDir = mkdtempSync(join(tmpdir(), "legacy-store-"));
			try {
				const legacyDb = loadSqliteDb(join(legacyDir, "sessions.db"));
				legacyDb.exec(`CREATE TABLE sessions (
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
				legacyDb.exec(`INSERT INTO sessions (
					session_id, source, pid, started_at, ended_at, exit_code, status, status_lock, interactive,
					provider, model, cwd, workspace_root, team_name, enable_tools, enable_spawn, enable_teams,
					parent_session_id, parent_agent_id, agent_id, conversation_id, is_subagent, prompt,
					metadata_json, hook_path, messages_path, updated_at
				) VALUES (
					'sess_legacy_data', 'cli', 999, '2026-09-01T00:00:00.000Z', NULL, NULL, 'completed', 0, 1,
					'anthropic', 'claude-3-5-sonnet', '/legacy/app', '/legacy', NULL, 1, 0, 0,
					NULL, NULL, NULL, NULL, 0, 'legacy prompt',
					'{"key":"val"}', '', '/legacy/msg.json', '2026-09-01T00:00:00.000Z'
				);`);
				legacyDb.close?.();

				// Open with SqliteSessionStore
				const newStore = new SqliteSessionStore({ sessionsDir: legacyDir });
				newStore.init();

				const record = newStore.get("sess_legacy_data");
				expect(record).toBeDefined();
				expect(record?.sessionId).toBe("sess_legacy_data");
				expect(record?.prompt).toBe("legacy prompt");
				expect(record?.metadata).toEqual({ key: "val" });
				expect(record?.anchorWorkspacePath).toBe("/legacy");

				newStore.close();
			} finally {
				rmSync(legacyDir, { recursive: true, force: true });
			}
		});
	});
});
