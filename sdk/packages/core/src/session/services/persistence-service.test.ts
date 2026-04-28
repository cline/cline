import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteSessionStore } from "../../services/storage/sqlite-session-store";
import { SessionSource } from "../../types/common";
import { CoreSessionService } from "../services/session-service";

const require = createRequire(import.meta.url);
const sqliteAvailable = (() => {
	try {
		require("node:sqlite");
		return true;
	} catch {
		return false;
	}
})();

describe("UnifiedSessionPersistenceService", () => {
	const tempDirs: string[] = [];
	const stores: Array<SqliteSessionStore> = [];
	const sqliteIt = sqliteAvailable ? it : it.skip;

	afterEach(() => {
		for (const store of stores.splice(0)) {
			store.close();
		}
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	sqliteIt(
		"reconciles dead running sessions into failed manifests with terminal markers",
		async () => {
			const dbDir = mkdtempSync(join(tmpdir(), "stale-session-reconcile-db-"));
			const sessionsDir = mkdtempSync(
				join(tmpdir(), "stale-session-reconcile-sessions-"),
			);
			tempDirs.push(dbDir, sessionsDir);

			const store = new SqliteSessionStore({ sessionsDir: dbDir });
			stores.push(store);
			const service = new CoreSessionService(store, {
				sessionArtifactsDir: sessionsDir,
			});
			const sessionId = "stale-root-session";
			const artifacts = await service.createRootSessionWithArtifacts({
				sessionId,
				source: SessionSource.CLI,
				pid: 999_999_999,
				interactive: false,
				provider: "mock-provider",
				model: "mock-model",
				cwd: "/tmp/project",
				workspaceRoot: "/tmp/project",
				enableTools: true,
				enableSpawn: true,
				enableTeams: false,
				prompt: "hello",
				startedAt: "2026-01-01T00:00:00.000Z",
			});

			const reconciled = await service.reconcileDeadSessions();
			expect(reconciled).toBe(1);

			const rows = await service.listSessions(10);
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({
				sessionId,
				status: "failed",
				exitCode: 1,
			});
			expect(rows[0]?.endedAt).toBeTruthy();

			const manifest = JSON.parse(
				readFileSync(artifacts.manifestPath, "utf8"),
			) as Record<string, unknown>;
			expect(manifest.status).toBe("failed");
			expect(manifest.exit_code).toBe(1);
			expect(manifest.ended_at).toBeTruthy();
			expect(manifest.metadata).toMatchObject({
				terminal_marker: "failed_external_process_exit",
				terminal_marker_pid: 999_999_999,
				terminal_marker_source: "stale_session_reconciler",
			});
			expect(
				(manifest.metadata as Record<string, unknown>).terminal_marker_at,
			).toBeTruthy();

			const globalHookLog = process.env.CLINE_HOOKS_LOG_PATH ?? "";
			if (globalHookLog && existsSync(globalHookLog)) {
				const hookContent = readFileSync(globalHookLog, "utf8");
				expect(hookContent).toContain('"hookName":"session_shutdown"');
				expect(hookContent).toContain(
					'"reason":"failed_external_process_exit"',
				);
			}
		},
		15_000,
	);

	sqliteIt(
		"persists teammate task metadata in the file envelope and usage on messages",
		async () => {
			const dbDir = mkdtempSync(join(tmpdir(), "team-task-messages-db-"));
			const sessionsDir = mkdtempSync(join(tmpdir(), "team-task-messages-"));
			tempDirs.push(dbDir, sessionsDir);

			const store = new SqliteSessionStore({ sessionsDir: dbDir });
			stores.push(store);
			const service = new CoreSessionService(store, {
				sessionArtifactsDir: sessionsDir,
			});
			const rootSessionId = "root-session";
			await service.createRootSessionWithArtifacts({
				sessionId: rootSessionId,
				source: SessionSource.CLI,
				pid: process.pid,
				interactive: false,
				provider: "anthropic",
				model: "claude-sonnet-4-6",
				cwd: "/tmp/project",
				workspaceRoot: "/tmp/project",
				enableTools: true,
				enableSpawn: true,
				enableTeams: true,
				prompt: "lead task",
				startedAt: "2026-04-10T19:00:00.000Z",
			});

			await service.onTeamTaskStart(
				rootSessionId,
				"java-haiku-agent",
				"Write a haiku about Java",
			);
			await service.onTeamTaskEnd(
				rootSessionId,
				"java-haiku-agent",
				"completed",
				"[done] completed",
				{
					text: "Classes wrap the world\nWrite once, run on every machine —\nVerbose, yet it soars",
					usage: {
						inputTokens: 42,
						outputTokens: 17,
						cacheReadTokens: 9,
						cacheWriteTokens: 0,
						totalCost: 0.123,
					},
					messages: [
						{
							role: "user",
							content: "Write a haiku about Java. Return only the haiku.",
						},
						{
							role: "assistant",
							content: [
								{
									type: "text",
									text: "Classes wrap the world\nWrite once, run on every machine —\nVerbose, yet it soars",
								},
							],
						},
					],
					toolCalls: [],
					iterations: 1,
					finishReason: "completed",
					model: {
						id: "claude-sonnet-4-6",
						provider: "anthropic",
						info: { id: "claude-sonnet-4-6" },
					},
					startedAt: new Date("2026-04-10T19:00:01.000Z"),
					endedAt: new Date("2026-04-10T19:00:02.000Z"),
					durationMs: 1000,
				},
			);

			const childSessions = await service.listSessions(10);
			const teammateSessionId = childSessions.find((row) =>
				row.sessionId.includes("__teamtask__java-haiku-agent__"),
			)?.sessionId;
			expect(teammateSessionId).toBeTruthy();
			const row = childSessions.find(
				(item) => item.sessionId === teammateSessionId,
			);
			expect(row?.messagesPath).toBeTruthy();
			const path = row?.messagesPath as string;
			const payload = JSON.parse(readFileSync(path, "utf8")) as {
				agent?: string;
				sessionId?: string;
				taskType?: string;
				messages: Array<Record<string, unknown>>;
			};
			const user = payload.messages[0] as Record<string, unknown>;
			const assistant = payload.messages[1] as Record<string, unknown>;

			expect(payload.agent).toBe("teammate");
			expect(payload.sessionId).toBe(rootSessionId);
			expect(payload.taskType).toBe("team");
			expect(assistant.id).toEqual(expect.any(String));
			expect(user.agent).toBeUndefined();
			expect(user.sessionId).toBeUndefined();
			expect(assistant.agent).toBeUndefined();
			expect(assistant.sessionId).toBeUndefined();
			expect(assistant.modelInfo).toMatchObject({
				id: "claude-sonnet-4-6",
				provider: "anthropic",
			});
			expect(assistant.metrics).toMatchObject({
				inputTokens: 42,
				outputTokens: 17,
				cacheReadTokens: 9,
				cacheWriteTokens: 0,
				cost: 0.123,
			});
			expect(row?.messagesPath).toBe(path);
		},
	);

	sqliteIt(
		"uploads messages after persisting them when a messages uploader is configured",
		async () => {
			const dbDir = mkdtempSync(join(tmpdir(), "messages-upload-db-"));
			const sessionsDir = mkdtempSync(join(tmpdir(), "messages-upload-"));
			tempDirs.push(dbDir, sessionsDir);

			const store = new SqliteSessionStore({ sessionsDir: dbDir });
			stores.push(store);
			const uploadMessagesFile = vi.fn(async () => {});
			const service = new CoreSessionService(store, {
				sessionArtifactsDir: sessionsDir,
				messagesArtifactUploader: {
					uploadMessagesFile,
				},
			});
			const sessionId = "root-upload-session";
			await service.createRootSessionWithArtifacts({
				sessionId,
				source: SessionSource.CLI,
				pid: process.pid,
				interactive: false,
				provider: "anthropic",
				model: "claude-sonnet-4-6",
				cwd: "/tmp/project",
				workspaceRoot: "/tmp/project",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				prompt: "hello",
				metadata: {
					blobUpload: true,
				},
				startedAt: "2026-04-10T19:00:00.000Z",
			});

			await service.persistSessionMessages(sessionId, [
				{
					role: "user",
					content: "hello",
				},
			]);

			expect(uploadMessagesFile).toHaveBeenCalledTimes(1);
			expect(uploadMessagesFile).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId,
					path: expect.stringContaining(`${sessionId}.messages.json`),
					contents: expect.stringContaining('"role": "user"'),
					row: expect.objectContaining({
						sessionId,
						metadata: {
							blobUpload: true,
							title: "hello",
						},
					}),
				}),
			);
		},
	);

	sqliteIt(
		"deletes the full root session directory even when artifact paths are stale",
		async () => {
			const dbDir = mkdtempSync(join(tmpdir(), "delete-root-session-dir-db-"));
			const sessionsDir = mkdtempSync(
				join(tmpdir(), "delete-root-session-dir-"),
			);
			tempDirs.push(dbDir, sessionsDir);

			const store = new SqliteSessionStore({ sessionsDir: dbDir });
			stores.push(store);
			const service = new CoreSessionService(store, {
				sessionArtifactsDir: sessionsDir,
			});
			const sessionId = "root-session-delete";
			const artifacts = await service.createRootSessionWithArtifacts({
				sessionId,
				source: SessionSource.CLI,
				pid: process.pid,
				interactive: false,
				provider: "anthropic",
				model: "claude-sonnet-4-6",
				cwd: "/tmp/project",
				workspaceRoot: "/tmp/project",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				prompt: "delete me",
				startedAt: "2026-04-10T19:00:00.000Z",
			});

			store.run(
				`UPDATE sessions SET messages_path = NULL WHERE session_id = ?`,
				[sessionId],
			);

			expect(existsSync(artifacts.messagesPath)).toBe(true);
			expect(existsSync(join(sessionsDir, sessionId))).toBe(true);

			const result = await service.deleteSession(sessionId);

			expect(result).toEqual({ deleted: true });
			expect(existsSync(artifacts.messagesPath)).toBe(false);
			expect(existsSync(join(sessionsDir, sessionId))).toBe(false);
		},
	);
});
