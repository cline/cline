import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteSessionStore } from "../../services/storage/sqlite-session-store";
import { SessionSource } from "../../types/common";
import { createSessionCompactionState } from "../models/session-compaction";
import type { SessionRow } from "../models/session-row";
import { FileSessionService } from "../services/file-session-service";
import type { SessionPersistenceAdapter } from "../services/persistence-service";
import { CoreSessionService } from "../services/session-service";

function makeSubagentRow(input: {
	sessionId: string;
	parentSessionId: string;
	startedAt: string;
}): SessionRow {
	return {
		sessionId: input.sessionId,
		source: "cli",
		pid: 999_999_999,
		startedAt: input.startedAt,
		endedAt: input.startedAt,
		exitCode: 0,
		status: "completed",
		statusLock: 0,
		interactive: false,
		provider: "mock-provider",
		model: "mock-model",
		cwd: "/tmp/project",
		workspaceRoot: "/tmp/project",
		teamName: null,
		enableTools: true,
		enableSpawn: false,
		enableTeams: false,
		parentSessionId: input.parentSessionId,
		parentAgentId: "lead",
		agentId: `${input.sessionId}-agent`,
		conversationId: null,
		isSubagent: true,
		prompt: null,
		metadata: null,
		hookPath: "",
		messagesPath: null,
		updatedAt: input.startedAt,
	};
}

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

	it("does not allocate a session while rejecting messages for an unknown id", async () => {
		const sessionsDir = mkdtempSync(
			join(tmpdir(), "unknown-session-messages-"),
		);
		tempDirs.push(sessionsDir);
		const service = new FileSessionService(sessionsDir);
		const sessionId = "not-allocated";

		await expect(
			service.persistSessionMessages(sessionId, [
				{ role: "user", content: "do not orphan me" },
			]),
		).rejects.toThrow(
			`Cannot persist messages for unknown session: ${sessionId}`,
		);
		expect(await service.listSessions()).toEqual([]);
		expect(existsSync(join(sessionsDir, sessionId))).toBe(false);
	});

	sqliteIt(
		"re-adopts the session row from the on-disk manifest when the DB row is missing",
		async () => {
			const dbDir = mkdtempSync(join(tmpdir(), "readopt-row-db-"));
			const sessionsDir = mkdtempSync(join(tmpdir(), "readopt-row-"));
			tempDirs.push(dbDir, sessionsDir);

			const store = new SqliteSessionStore({ sessionsDir: dbDir });
			stores.push(store);
			const service = new CoreSessionService(store, {
				sessionArtifactsDir: sessionsDir,
			});
			const sessionId = "resumed-session-without-row";
			const artifacts = await service.createRootSessionWithArtifacts({
				sessionId,
				source: SessionSource.CLI,
				pid: process.pid,
				interactive: true,
				provider: "anthropic",
				model: "claude-sonnet",
				cwd: "/tmp/project",
				workspaceRoot: "/tmp/project",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				prompt: "hello",
				startedAt: "2026-01-01T00:00:00.000Z",
			});
			// Simulate a rebuilt session DB: artifacts on disk, row gone.
			store.run("DELETE FROM sessions WHERE session_id = ?", [sessionId]);

			await service.persistSessionMessages(sessionId, [
				{ role: "user", content: "hello again" },
			]);

			const payload = JSON.parse(
				readFileSync(artifacts.messagesPath, "utf8"),
			) as { messages?: unknown[] };
			expect(payload.messages).toHaveLength(1);
			const rows = await service.listSessions();
			expect(rows.map((row) => row.sessionId)).toContain(sessionId);
		},
	);

	it("persists compaction state as a separate session artifact", async () => {
		const sessionsDir = mkdtempSync(join(tmpdir(), "compaction-artifact-"));
		tempDirs.push(sessionsDir);
		const service = new FileSessionService(sessionsDir);
		const sessionId = "session-with-compaction";
		const artifacts = await service.createRootSessionWithArtifacts({
			sessionId,
			source: SessionSource.CLI,
			pid: process.pid,
			interactive: true,
			provider: "anthropic",
			model: "claude-sonnet",
			cwd: "/tmp/project",
			workspaceRoot: "/tmp/project",
			enableTools: true,
			enableSpawn: true,
			enableTeams: false,
			startedAt: "2026-01-01T00:00:00.000Z",
		});
		const sourceMessages = [
			{ id: "u1", role: "user" as const, content: "full transcript" },
		];
		const compactedMessages = [
			{ id: "summary", role: "user" as const, content: "summary" },
		];
		const state = createSessionCompactionState({
			sourceMessages,
			compactedMessages,
			conversationId: "conv-1",
			updatedAt: "2026-01-01T00:00:01.000Z",
		});
		expect(
			JSON.parse(readFileSync(artifacts.manifestPath, "utf8")),
		).not.toHaveProperty("compaction_path");
		expect(existsSync(artifacts.compactionPath ?? "")).toBe(false);

		await service.persistSessionMessages(sessionId, sourceMessages);
		await service.persistSessionCompactionState(sessionId, state);

		expect(
			JSON.parse(readFileSync(artifacts.manifestPath, "utf8")),
		).toHaveProperty("compaction_path", artifacts.compactionPath);
		const messagesPayload = JSON.parse(
			readFileSync(artifacts.messagesPath, "utf8"),
		) as { messages?: unknown[] };
		const compactionPayload = JSON.parse(
			readFileSync(artifacts.compactionPath ?? "", "utf8"),
		) as { messages?: unknown[]; source_message_count?: number };
		expect(messagesPayload.messages).toHaveLength(1);
		expect(compactionPayload).toMatchObject({
			source_message_count: 1,
			messages: compactedMessages,
		});
		await expect(
			service.readSessionCompactionState(sessionId),
		).resolves.toMatchObject({
			source_message_count: 1,
			messages: compactedMessages,
		});
	});

	it("deletes persisted compaction state without mutating canonical messages", async () => {
		const sessionsDir = mkdtempSync(join(tmpdir(), "compaction-delete-"));
		tempDirs.push(sessionsDir);
		const service = new FileSessionService(sessionsDir);
		const sessionId = "session-delete-compaction";
		const artifacts = await service.createRootSessionWithArtifacts({
			sessionId,
			source: SessionSource.CLI,
			pid: process.pid,
			interactive: true,
			provider: "anthropic",
			model: "claude-sonnet",
			cwd: "/tmp/project",
			workspaceRoot: "/tmp/project",
			enableTools: true,
			enableSpawn: true,
			enableTeams: false,
			startedAt: "2026-01-01T00:00:00.000Z",
		});
		const sourceMessages = [
			{ id: "u1", role: "user" as const, content: "full transcript" },
		];
		const state = createSessionCompactionState({
			sourceMessages,
			compactedMessages: [
				{ id: "summary", role: "user" as const, content: "summary" },
			],
			updatedAt: "2026-01-01T00:00:01.000Z",
		});

		await service.persistSessionMessages(sessionId, sourceMessages);
		await service.persistSessionCompactionState(sessionId, state);
		expect(existsSync(artifacts.compactionPath ?? "")).toBe(true);
		await service.deleteSessionCompactionState(sessionId);

		expect(existsSync(artifacts.messagesPath)).toBe(true);
		expect(existsSync(artifacts.compactionPath ?? "")).toBe(false);
		expect(
			JSON.parse(readFileSync(artifacts.manifestPath, "utf8")),
		).not.toHaveProperty("compaction_path");
		await expect(
			service.readSessionCompactionState(sessionId),
		).resolves.toBeUndefined();
	});

	it("adds compaction path to old manifests only when sidecar is written", async () => {
		const sessionsDir = mkdtempSync(join(tmpdir(), "compaction-old-manifest-"));
		tempDirs.push(sessionsDir);
		const service = new FileSessionService(sessionsDir);
		const sessionId = "session-old-manifest";
		const artifacts = await service.createRootSessionWithArtifacts({
			sessionId,
			source: SessionSource.CLI,
			pid: process.pid,
			interactive: true,
			provider: "anthropic",
			model: "claude-sonnet",
			cwd: "/tmp/project",
			workspaceRoot: "/tmp/project",
			enableTools: true,
			enableSpawn: true,
			enableTeams: false,
			startedAt: "2026-01-01T00:00:00.000Z",
		});
		const manifest = JSON.parse(
			readFileSync(artifacts.manifestPath, "utf8"),
		) as {
			compaction_path?: string;
		};
		delete manifest.compaction_path;
		writeFileSync(
			artifacts.manifestPath,
			`${JSON.stringify(manifest, null, 2)}\n`,
			"utf8",
		);
		const state = createSessionCompactionState({
			sourceMessages: [
				{ id: "u1", role: "user" as const, content: "full transcript" },
			],
			compactedMessages: [
				{ id: "summary", role: "user" as const, content: "summary" },
			],
			updatedAt: "2026-01-01T00:00:01.000Z",
		});

		await service.persistSessionCompactionState(sessionId, state);

		expect(existsSync(artifacts.compactionPath ?? "")).toBe(true);
		expect(
			JSON.parse(readFileSync(artifacts.manifestPath, "utf8")),
		).toHaveProperty("compaction_path", artifacts.compactionPath);
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
		"prunes database rows when a root session artifact directory is removed",
		async () => {
			const dbDir = mkdtempSync(join(tmpdir(), "removed-session-prune-db-"));
			const sessionsDir = mkdtempSync(
				join(tmpdir(), "removed-session-prune-sessions-"),
			);
			tempDirs.push(dbDir, sessionsDir);

			const store = new SqliteSessionStore({ sessionsDir: dbDir });
			stores.push(store);
			const service = new CoreSessionService(store, {
				sessionArtifactsDir: sessionsDir,
			});
			const sessionId = "removed-root-session";
			await service.createRootSessionWithArtifacts({
				sessionId,
				source: SessionSource.CLI,
				pid: process.pid,
				interactive: false,
				provider: "mock-provider",
				model: "mock-model",
				cwd: "/tmp/project",
				workspaceRoot: "/tmp/project",
				enableTools: true,
				enableSpawn: true,
				enableTeams: true,
				prompt: "hello",
				startedAt: "2026-01-01T00:00:00.000Z",
			});
			await service.onTeamTaskStart(
				sessionId,
				"java-haiku-agent",
				"Write a haiku about Java",
			);
			await expect(
				service.updateSessionStatus(sessionId, "completed", 0),
			).resolves.toMatchObject({ updated: true });

			rmSync(join(sessionsDir, sessionId), { recursive: true, force: true });

			await expect(service.listSessions(10)).resolves.toEqual([]);
			await expect(
				service.reconcileMissingArtifactSessions(10),
			).resolves.toBeGreaterThanOrEqual(0);
			expect(
				store.queryOne(`SELECT session_id FROM sessions WHERE session_id = ?`, [
					sessionId,
				]),
			).toBeUndefined();
			expect(
				store.queryAll(
					`SELECT session_id FROM sessions WHERE parent_session_id = ?`,
					[sessionId],
				),
			).toEqual([]);
		},
	);

	it("prunes indexed rows when a root session artifact directory is removed", async () => {
		const sessionsDir = mkdtempSync(
			join(tmpdir(), "removed-session-prune-file-"),
		);
		tempDirs.push(sessionsDir);

		const service = new FileSessionService(sessionsDir);
		const sessionId = "removed-file-root-session";
		await service.createRootSessionWithArtifacts({
			sessionId,
			source: SessionSource.CLI,
			pid: process.pid,
			interactive: false,
			provider: "mock-provider",
			model: "mock-model",
			cwd: "/tmp/project",
			workspaceRoot: "/tmp/project",
			enableTools: true,
			enableSpawn: true,
			enableTeams: true,
			prompt: "hello",
			startedAt: "2026-01-01T00:00:00.000Z",
		});
		await service.onTeamTaskStart(
			sessionId,
			"java-haiku-agent",
			"Write a haiku about Java",
		);
		await expect(
			service.updateSessionStatus(sessionId, "completed", 0),
		).resolves.toMatchObject({ updated: true });

		rmSync(join(sessionsDir, sessionId), { recursive: true, force: true });

		await expect(service.listSessions(10)).resolves.toEqual([]);
		await expect(
			service.reconcileMissingArtifactSessions(10),
		).resolves.toBeGreaterThanOrEqual(0);
		const index = JSON.parse(
			readFileSync(join(sessionsDir, "sessions.index.json"), "utf8"),
		) as { sessions: Record<string, unknown> };
		expect(index.sessions[sessionId]).toBeUndefined();
		expect(Object.values(index.sessions)).toEqual([]);
	});

	it("does not prune a live non-terminal session with missing artifacts", async () => {
		const sessionsDir = mkdtempSync(join(tmpdir(), "live-session-prune-file-"));
		tempDirs.push(sessionsDir);

		const service = new FileSessionService(sessionsDir);
		const sessionId = "live-file-root-session";
		await service.createRootSessionWithArtifacts({
			sessionId,
			source: SessionSource.CLI,
			pid: process.pid,
			interactive: false,
			provider: "mock-provider",
			model: "mock-model",
			cwd: "/tmp/project",
			workspaceRoot: "/tmp/project",
			enableTools: true,
			enableSpawn: false,
			enableTeams: false,
			prompt: "still running",
			startedAt: "2026-01-01T00:00:00.000Z",
		});

		rmSync(join(sessionsDir, sessionId), { recursive: true, force: true });

		await expect(service.reconcileMissingArtifactSessions(10)).resolves.toBe(0);
		const index = JSON.parse(
			readFileSync(join(sessionsDir, "sessions.index.json"), "utf8"),
		) as { sessions: Record<string, unknown> };
		expect(index.sessions[sessionId]).toBeTruthy();
	});

	it("does not prune a child row with null messagesPath while its parent artifacts exist", async () => {
		const sessionsDir = mkdtempSync(
			join(tmpdir(), "null-child-messages-prune-file-"),
		);
		tempDirs.push(sessionsDir);

		const service = new FileSessionService(sessionsDir);
		const rootSessionId = "healthy-parent-session";
		await service.createRootSessionWithArtifacts({
			sessionId: rootSessionId,
			source: SessionSource.CLI,
			pid: process.pid,
			interactive: false,
			provider: "mock-provider",
			model: "mock-model",
			cwd: "/tmp/project",
			workspaceRoot: "/tmp/project",
			enableTools: true,
			enableSpawn: true,
			enableTeams: true,
			prompt: "parent",
			startedAt: "2026-01-01T00:00:00.000Z",
		});
		await service.onTeamTaskStart(
			rootSessionId,
			"java-haiku-agent",
			"Write a haiku about Java",
		);

		const indexPath = join(sessionsDir, "sessions.index.json");
		const index = JSON.parse(readFileSync(indexPath, "utf8")) as {
			sessions: Record<
				string,
				{ messagesPath?: string | null; status?: string }
			>;
		};
		const childSessionId = Object.keys(index.sessions).find(
			(sessionId) => sessionId !== rootSessionId,
		);
		expect(childSessionId).toBeTruthy();
		const child = index.sessions[childSessionId as string];
		child.messagesPath = null;
		child.status = "completed";
		writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");

		await expect(service.reconcileMissingArtifactSessions(10)).resolves.toBe(0);
		const nextIndex = JSON.parse(readFileSync(indexPath, "utf8")) as {
			sessions: Record<string, unknown>;
		};
		expect(nextIndex.sessions[childSessionId as string]).toBeTruthy();
	});

	it("continues scanning after stale rows to return older valid sessions", async () => {
		const sessionsDir = mkdtempSync(
			join(tmpdir(), "stale-session-window-file-"),
		);
		tempDirs.push(sessionsDir);

		const service = new FileSessionService(sessionsDir);
		for (let index = 0; index < 11; index += 1) {
			const sessionId = `removed-window-session-${index}`;
			await service.createRootSessionWithArtifacts({
				sessionId,
				source: SessionSource.CLI,
				pid: process.pid,
				interactive: false,
				provider: "mock-provider",
				model: "mock-model",
				cwd: "/tmp/project",
				workspaceRoot: "/tmp/project",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				prompt: `removed ${index}`,
				startedAt: `2026-01-02T00:00:${String(index).padStart(2, "0")}.000Z`,
			});
			rmSync(join(sessionsDir, sessionId), { recursive: true, force: true });
		}

		for (let index = 0; index < 2; index += 1) {
			await service.createRootSessionWithArtifacts({
				sessionId: `valid-window-session-${index}`,
				source: SessionSource.CLI,
				pid: process.pid,
				interactive: false,
				provider: "mock-provider",
				model: "mock-model",
				cwd: "/tmp/project",
				workspaceRoot: "/tmp/project",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				prompt: `valid ${index}`,
				startedAt: `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
			});
		}

		const rows = await service.listSessions(2);

		expect(rows.map((row) => row.sessionId)).toEqual([
			"valid-window-session-1",
			"valid-window-session-0",
		]);
	});

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
				mode: "user",
				version: "3.99.0",
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
				origin?: {
					source?: string;
					mode?: string;
					sessionId?: string;
					parentThreadId?: string;
					subagent?: string;
					version?: string;
				};
				messages: Array<Record<string, unknown>>;
			};
			const user = payload.messages[0] as Record<string, unknown>;
			const assistant = payload.messages[1] as Record<string, unknown>;

			expect(payload.agent).toBe("teammate");
			expect(payload.sessionId).toBe(teammateSessionId);
			expect(payload.taskType).toBe("team");
			expect(payload.origin).toEqual({
				source: "cli",
				mode: "team",
				sessionId: teammateSessionId,
				parentThreadId: rootSessionId,
				subagent: "java-haiku-agent",
				version: "3.99.0",
			});
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

	it("persists plain spawn_agent result usage on child messages", async () => {
		const sessionsDir = mkdtempSync(join(tmpdir(), "spawn-agent-messages-"));
		tempDirs.push(sessionsDir);

		const service = new FileSessionService(sessionsDir);
		const rootSessionId = "root-spawn-session";
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

		const context = {
			subAgentId: "plain-worker",
			conversationId: "conv-plain-worker",
			parentAgentId: "lead",
			input: {
				systemPrompt: "You are a worker.",
				task: "Summarize the repo.",
			},
		};
		await service.handleSubAgentStart(rootSessionId, context);
		await service.handleSubAgentEnd(rootSessionId, {
			...context,
			result: {
				text: "Done",
				iterations: 1,
				finishReason: "completed",
				usage: {
					inputTokens: 11,
					outputTokens: 3,
				},
			},
			agentResult: {
				text: "Done",
				usage: {
					inputTokens: 11,
					outputTokens: 3,
					cacheReadTokens: 4,
					cacheWriteTokens: 2,
					totalCost: 0.045,
				},
				messages: [
					{ role: "user", content: "Summarize the repo." },
					{ role: "assistant", content: "Done" },
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
		});

		const childSessions = await service.listSessions(10);
		const row = childSessions.find((item) => item.agentId === "plain-worker");
		expect(row?.status).toBe("completed");
		expect(row?.messagesPath).toBeTruthy();
		const payload = JSON.parse(
			readFileSync(row?.messagesPath as string, "utf8"),
		) as {
			messages: Array<Record<string, unknown>>;
		};
		const assistant = payload.messages[1] as Record<string, unknown>;

		expect(assistant.metrics).toMatchObject({
			inputTokens: 11,
			outputTokens: 3,
			cacheReadTokens: 4,
			cacheWriteTokens: 2,
			cost: 0.045,
		});
	});

	it("preserves an existing title when the stored prompt changes", async () => {
		const sessionsDir = mkdtempSync(join(tmpdir(), "prompt-title-sessions-"));
		tempDirs.push(sessionsDir);

		const service = new FileSessionService(sessionsDir);
		const sessionId = "prompt-title-session";
		const artifacts = await service.createRootSessionWithArtifacts({
			sessionId,
			source: SessionSource.CLI,
			pid: process.pid,
			interactive: true,
			provider: "mock-provider",
			model: "mock-model",
			cwd: "/tmp/project",
			workspaceRoot: "/tmp/project",
			enableTools: true,
			enableSpawn: true,
			enableTeams: false,
			prompt: "first user message",
			startedAt: "2026-01-01T00:00:00.000Z",
		});

		await expect(
			service.updateSession({ sessionId, prompt: "second user message" }),
		).resolves.toEqual({ updated: true });

		const [row] = await service.listSessions(10);
		expect(row?.prompt).toBe("second user message");
		expect(row?.metadata).toMatchObject({ title: "first user message" });
		const manifest = JSON.parse(
			readFileSync(artifacts.manifestPath, "utf8"),
		) as Record<string, unknown>;
		expect(manifest.prompt).toBe("second user message");
		expect(manifest.metadata).toMatchObject({ title: "first user message" });
	});

	it("derives a title from a prompt only when the session has no title yet", async () => {
		const sessionsDir = mkdtempSync(join(tmpdir(), "empty-title-sessions-"));
		tempDirs.push(sessionsDir);

		const service = new FileSessionService(sessionsDir);
		const sessionId = "empty-title-session";
		await service.createRootSessionWithArtifacts({
			sessionId,
			source: SessionSource.CLI,
			pid: process.pid,
			interactive: true,
			provider: "mock-provider",
			model: "mock-model",
			cwd: "/tmp/project",
			workspaceRoot: "/tmp/project",
			enableTools: true,
			enableSpawn: true,
			enableTeams: false,
			startedAt: "2026-01-01T00:00:00.000Z",
		});

		await expect(
			service.updateSession({ sessionId, prompt: "first saved prompt" }),
		).resolves.toEqual({ updated: true });

		const [row] = await service.listSessions(10);
		expect(row?.metadata).toMatchObject({ title: "first saved prompt" });
	});

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
						metadata: expect.objectContaining({
							blobUpload: true,
							sessionHistoryOrigin: {
								mode: "user",
							},
							title: "hello",
						}),
					}),
				}),
			);
		},
	);

	sqliteIt(
		"keeps failed message uploads out of user-facing console output",
		async () => {
			const dbDir = mkdtempSync(join(tmpdir(), "messages-upload-fail-db-"));
			const sessionsDir = mkdtempSync(join(tmpdir(), "messages-upload-fail-"));
			tempDirs.push(dbDir, sessionsDir);

			const store = new SqliteSessionStore({ sessionsDir: dbDir });
			stores.push(store);
			const uploadError = new Error("upload denied");
			const uploadMessagesFile = vi.fn(async () => {
				throw uploadError;
			});
			const logger = {
				debug: vi.fn(),
				log: vi.fn(),
			};
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const service = new CoreSessionService(store, {
				sessionArtifactsDir: sessionsDir,
				messagesArtifactUploader: {
					uploadMessagesFile,
				},
				logger,
			});
			const sessionId = "root-upload-fail-session";
			await service.createRootSessionWithArtifacts({
				sessionId,
				source: SessionSource.CLI,
				pid: process.pid,
				interactive: false,
				provider: "openrouter",
				model: "qwen/qwen3.6-plus",
				cwd: "/tmp/project",
				workspaceRoot: "/tmp/project",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				prompt: "hello",
				startedAt: "2026-04-10T19:00:00.000Z",
			});

			try {
				await expect(
					service.persistSessionMessages(sessionId, [
						{
							role: "user",
							content: "hello",
						},
					]),
				).resolves.toBeUndefined();
				expect(warn).not.toHaveBeenCalled();
			} finally {
				warn.mockRestore();
			}

			expect(uploadMessagesFile).toHaveBeenCalledTimes(1);
			expect(logger.debug).toHaveBeenCalledWith(
				"Failed to upload persisted session messages",
				{
					sessionId,
					error: uploadError,
				},
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

	sqliteIt(
		"returns older valid sessions when cleanup deletes earlier-page rows between pages",
		async () => {
			const dbDir = mkdtempSync(join(tmpdir(), "page-race-db-"));
			const sessionsDir = mkdtempSync(join(tmpdir(), "page-race-sessions-"));
			tempDirs.push(dbDir, sessionsDir);

			const store = new SqliteSessionStore({ sessionsDir: dbDir });
			stores.push(store);
			const service = new CoreSessionService(store, {
				sessionArtifactsDir: sessionsDir,
			});
			// Keep the scheduled background cleanup inert so this test controls
			// exactly when rows are deleted relative to page fetches.
			vi.spyOn(service, "reconcileMissingArtifactSessions").mockResolvedValue(
				0,
			);

			// 510 stale rows (no artifacts on disk) newer than 2 valid rows, so
			// the scan must cross a 500-row page boundary to reach the valid ones.
			const staleStartedAt = "2026-06-01T00:00:00.000Z";
			for (let index = 0; index < 510; index += 1) {
				const sessionId = `stale-${String(index).padStart(4, "0")}`;
				service.createRootSession({
					sessionId,
					source: SessionSource.CLI,
					pid: 999_999_999,
					startedAt: staleStartedAt,
					interactive: false,
					provider: "mock-provider",
					model: "mock-model",
					cwd: "/tmp/project",
					workspaceRoot: "/tmp/project",
					enableTools: true,
					enableSpawn: false,
					enableTeams: false,
					messagesPath: join(sessionsDir, sessionId, "messages.json"),
				});
			}
			store.run(
				`UPDATE sessions SET status = 'completed' WHERE session_id LIKE 'stale-%'`,
				[],
			);
			for (let index = 0; index < 2; index += 1) {
				await service.createRootSessionWithArtifacts({
					sessionId: `valid-${index}`,
					source: SessionSource.CLI,
					pid: process.pid,
					interactive: false,
					provider: "mock-provider",
					model: "mock-model",
					cwd: "/tmp/project",
					workspaceRoot: "/tmp/project",
					enableTools: true,
					enableSpawn: false,
					enableTeams: false,
					prompt: `valid ${index}`,
					startedAt: `2026-01-01T00:00:0${index}.000Z`,
				});
			}

			// Simulate the cleanup race: after the first page of the artifact
			// scan is fetched, delete 200 stale rows that belong to that earlier
			// page. With positional OFFSET paging the surviving rows would shift
			// backwards across the offset boundary and be skipped.
			const adapter = (
				service as unknown as { adapter: SessionPersistenceAdapter }
			).adapter;
			const originalListSessions = adapter.listSessions.bind(adapter);
			let deletedBetweenPages = false;
			adapter.listSessions = async (options) => {
				const batch = await originalListSessions(options);
				if (
					!deletedBetweenPages &&
					options.limit === 500 &&
					options.status === undefined &&
					options.parentSessionId === undefined &&
					options.startedBefore === undefined
				) {
					deletedBetweenPages = true;
					store.run(
						`DELETE FROM sessions WHERE session_id >= 'stale-0310' AND session_id LIKE 'stale-%'`,
						[],
					);
				}
				return batch;
			};

			const rows = await service.listSessions(2);

			expect(deletedBetweenPages).toBe(true);
			expect(rows.map((row) => row.sessionId)).toEqual(["valid-1", "valid-0"]);
		},
		30_000,
	);

	sqliteIt(
		"finds valid sessions hidden behind a stale prefix larger than the former scan cap",
		async () => {
			const dbDir = mkdtempSync(join(tmpdir(), "stale-prefix-db-"));
			const sessionsDir = mkdtempSync(join(tmpdir(), "stale-prefix-sessions-"));
			tempDirs.push(dbDir, sessionsDir);

			const store = new SqliteSessionStore({ sessionsDir: dbDir });
			stores.push(store);
			const service = new CoreSessionService(store, {
				sessionArtifactsDir: sessionsDir,
			});
			vi.spyOn(service, "reconcileMissingArtifactSessions").mockResolvedValue(
				0,
			);

			// 2,100 stale rows exceed the previous fixed scan ceiling of 2,000
			// rows for listSessions(1); the older valid session must still be
			// found behind them.
			for (let index = 0; index < 2100; index += 1) {
				const sessionId = `stale-${String(index).padStart(4, "0")}`;
				service.createRootSession({
					sessionId,
					source: SessionSource.CLI,
					pid: 999_999_999,
					startedAt: "2026-06-01T00:00:00.000Z",
					interactive: false,
					provider: "mock-provider",
					model: "mock-model",
					cwd: "/tmp/project",
					workspaceRoot: "/tmp/project",
					enableTools: true,
					enableSpawn: false,
					enableTeams: false,
					messagesPath: join(sessionsDir, sessionId, "messages.json"),
				});
			}
			store.run(
				`UPDATE sessions SET status = 'completed' WHERE session_id LIKE 'stale-%'`,
				[],
			);
			await service.createRootSessionWithArtifacts({
				sessionId: "valid-behind-prefix",
				source: SessionSource.CLI,
				pid: process.pid,
				interactive: false,
				provider: "mock-provider",
				model: "mock-model",
				cwd: "/tmp/project",
				workspaceRoot: "/tmp/project",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				prompt: "valid",
				startedAt: "2026-01-01T00:00:00.000Z",
			});

			const rows = await service.listSessions(1);

			expect(rows.map((row) => row.sessionId)).toEqual(["valid-behind-prefix"]);
		},
		30_000,
	);

	sqliteIt(
		"does not prune a session that resumes between the stale check and the delete",
		async () => {
			const dbDir = mkdtempSync(join(tmpdir(), "resume-race-db-"));
			const sessionsDir = mkdtempSync(join(tmpdir(), "resume-race-sessions-"));
			tempDirs.push(dbDir, sessionsDir);

			const store = new SqliteSessionStore({ sessionsDir: dbDir });
			stores.push(store);
			const service = new CoreSessionService(store, {
				sessionArtifactsDir: sessionsDir,
			});
			const sessionId = "resume-race-session";
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
				enableSpawn: false,
				enableTeams: false,
				prompt: "resume me",
				startedAt: "2026-01-01T00:00:00.000Z",
			});
			const manifestJson = readFileSync(artifacts.manifestPath, "utf8");
			await expect(
				service.updateSessionStatus(sessionId, "failed", 1),
			).resolves.toMatchObject({ updated: true });
			rmSync(join(sessionsDir, sessionId), { recursive: true, force: true });

			// Deterministically resume the session (status update bumps the
			// row's statusLock) and recreate its artifacts at the boundary
			// between the prune loop's stale check and the delete: the delete
			// path re-reads the row via getSession first.
			const adapter = (
				service as unknown as { adapter: SessionPersistenceAdapter }
			).adapter;
			const originalGetSession = adapter.getSession.bind(adapter);
			let resumed = false;
			adapter.getSession = async (id) => {
				if (id === sessionId && !resumed) {
					resumed = true;
					store.run(
						`UPDATE sessions
						 SET status = 'running', ended_at = NULL, exit_code = NULL,
							 pid = ?, status_lock = status_lock + 1, updated_at = ?
						 WHERE session_id = ?`,
						[process.pid, new Date().toISOString(), sessionId],
					);
					mkdirSync(join(sessionsDir, sessionId), { recursive: true });
					writeFileSync(artifacts.manifestPath, manifestJson, "utf8");
				}
				return originalGetSession(id);
			};

			await expect(service.reconcileMissingArtifactSessions(10)).resolves.toBe(
				0,
			);

			expect(resumed).toBe(true);
			expect(
				store.queryOne(`SELECT status FROM sessions WHERE session_id = ?`, [
					sessionId,
				]),
			).toMatchObject({ status: "running" });
			expect(existsSync(artifacts.manifestPath)).toBe(true);
		},
	);

	sqliteIt(
		"does not prune a session whose artifacts are recreated between the stale check and the delete",
		async () => {
			const dbDir = mkdtempSync(join(tmpdir(), "recreate-race-db-"));
			const sessionsDir = mkdtempSync(
				join(tmpdir(), "recreate-race-sessions-"),
			);
			tempDirs.push(dbDir, sessionsDir);

			const store = new SqliteSessionStore({ sessionsDir: dbDir });
			stores.push(store);
			const service = new CoreSessionService(store, {
				sessionArtifactsDir: sessionsDir,
			});
			const sessionId = "recreate-race-session";
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
				enableSpawn: false,
				enableTeams: false,
				prompt: "recreate me",
				startedAt: "2026-01-01T00:00:00.000Z",
			});
			const manifestJson = readFileSync(artifacts.manifestPath, "utf8");
			await expect(
				service.updateSessionStatus(sessionId, "failed", 1),
			).resolves.toMatchObject({ updated: true });
			rmSync(join(sessionsDir, sessionId), { recursive: true, force: true });

			// Recreate only the on-disk artifacts (no row change) right when the
			// delete path re-reads the row; the artifact precondition recheck at
			// that boundary must keep the row.
			const adapter = (
				service as unknown as { adapter: SessionPersistenceAdapter }
			).adapter;
			const originalGetSession = adapter.getSession.bind(adapter);
			let recreated = false;
			adapter.getSession = async (id) => {
				if (id === sessionId && !recreated) {
					recreated = true;
					mkdirSync(join(sessionsDir, sessionId), { recursive: true });
					writeFileSync(artifacts.manifestPath, manifestJson, "utf8");
				}
				return originalGetSession(id);
			};

			await expect(service.reconcileMissingArtifactSessions(10)).resolves.toBe(
				0,
			);

			expect(recreated).toBe(true);
			expect(
				store.queryOne(`SELECT session_id FROM sessions WHERE session_id = ?`, [
					sessionId,
				]),
			).toBeTruthy();
			expect(existsSync(artifacts.manifestPath)).toBe(true);
		},
	);

	sqliteIt(
		"aborts the row delete when the session resumes after the delete-boundary recheck",
		async () => {
			const dbDir = mkdtempSync(join(tmpdir(), "delete-guard-db-"));
			const sessionsDir = mkdtempSync(join(tmpdir(), "delete-guard-sessions-"));
			tempDirs.push(dbDir, sessionsDir);

			const store = new SqliteSessionStore({ sessionsDir: dbDir });
			stores.push(store);
			const service = new CoreSessionService(store, {
				sessionArtifactsDir: sessionsDir,
			});
			const sessionId = "delete-guard-session";
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
				enableSpawn: false,
				enableTeams: false,
				prompt: "guard me",
				startedAt: "2026-01-01T00:00:00.000Z",
			});
			const manifestJson = readFileSync(artifacts.manifestPath, "utf8");
			await expect(
				service.updateSessionStatus(sessionId, "failed", 1),
			).resolves.toMatchObject({ updated: true });
			rmSync(join(sessionsDir, sessionId), { recursive: true, force: true });

			// Resume the session in the narrowest window: after the delete
			// boundary recheck passed, right before the adapter-level delete.
			// The conditional delete compares statusLock/updatedAt and must
			// no-op, leaving both the row and the recreated artifacts intact.
			const adapter = (
				service as unknown as { adapter: SessionPersistenceAdapter }
			).adapter;
			const originalDeleteSession = adapter.deleteSession.bind(adapter);
			let resumedBeforeDelete = false;
			adapter.deleteSession = async (id, cascade, guard) => {
				if (id === sessionId && guard && !resumedBeforeDelete) {
					resumedBeforeDelete = true;
					store.run(
						`UPDATE sessions
						 SET status = 'running', ended_at = NULL, exit_code = NULL,
							 pid = ?, status_lock = status_lock + 1, updated_at = ?
						 WHERE session_id = ?`,
						[process.pid, new Date().toISOString(), sessionId],
					);
					mkdirSync(join(sessionsDir, sessionId), { recursive: true });
					writeFileSync(artifacts.manifestPath, manifestJson, "utf8");
				}
				return originalDeleteSession(id, cascade, guard);
			};

			await expect(service.reconcileMissingArtifactSessions(10)).resolves.toBe(
				0,
			);

			expect(resumedBeforeDelete).toBe(true);
			expect(
				store.queryOne(`SELECT status FROM sessions WHERE session_id = ?`, [
					sessionId,
				]),
			).toMatchObject({ status: "running" });
			expect(existsSync(artifacts.manifestPath)).toBe(true);
		},
	);

	sqliteIt(
		"anchors nested subagent rows at the root session when pruning",
		async () => {
			const dbDir = mkdtempSync(join(tmpdir(), "nested-subagent-db-"));
			const sessionsDir = mkdtempSync(
				join(tmpdir(), "nested-subagent-sessions-"),
			);
			tempDirs.push(dbDir, sessionsDir);

			const store = new SqliteSessionStore({ sessionsDir: dbDir });
			stores.push(store);
			const service = new CoreSessionService(store, {
				sessionArtifactsDir: sessionsDir,
			});
			const rootSessionId = "nested-root-session";
			await service.createRootSessionWithArtifacts({
				sessionId: rootSessionId,
				source: SessionSource.CLI,
				pid: 999_999_999,
				interactive: false,
				provider: "mock-provider",
				model: "mock-model",
				cwd: "/tmp/project",
				workspaceRoot: "/tmp/project",
				enableTools: true,
				enableSpawn: true,
				enableTeams: true,
				prompt: "root",
				startedAt: "2026-01-01T00:00:00.000Z",
			});
			await expect(
				service.updateSessionStatus(rootSessionId, "completed", 0),
			).resolves.toMatchObject({ updated: true });

			const adapter = (
				service as unknown as { adapter: SessionPersistenceAdapter }
			).adapter;
			// Chain: root <- mid subagent <- leaf subagent. The leaf links to
			// another subagent rather than the root, so artifact checks must
			// walk the parent chain up to the root session.
			await adapter.upsertSession(
				makeSubagentRow({
					sessionId: "nested-mid-subagent",
					parentSessionId: rootSessionId,
					startedAt: "2026-01-01T00:00:01.000Z",
				}),
			);
			await adapter.upsertSession(
				makeSubagentRow({
					sessionId: "nested-leaf-subagent",
					parentSessionId: "nested-mid-subagent",
					startedAt: "2026-01-01T00:00:02.000Z",
				}),
			);

			// While the root's artifacts exist, none of the rows are pruned.
			await expect(service.reconcileMissingArtifactSessions(10)).resolves.toBe(
				0,
			);
			expect(
				store.queryAll(`SELECT session_id FROM sessions ORDER BY session_id`),
			).toHaveLength(3);

			// Once the root's artifacts are gone, the whole chain is pruned,
			// including the nested leaf whose parent link is another subagent.
			rmSync(join(sessionsDir, rootSessionId), {
				recursive: true,
				force: true,
			});
			await expect(
				service.reconcileMissingArtifactSessions(10),
			).resolves.toBeGreaterThanOrEqual(1);
			expect(store.queryAll(`SELECT session_id FROM sessions`)).toEqual([]);
		},
	);

	sqliteIt(
		"keeps nested subagent rows while the root session is still live",
		async () => {
			const dbDir = mkdtempSync(join(tmpdir(), "nested-live-db-"));
			const sessionsDir = mkdtempSync(join(tmpdir(), "nested-live-sessions-"));
			tempDirs.push(dbDir, sessionsDir);

			const store = new SqliteSessionStore({ sessionsDir: dbDir });
			stores.push(store);
			const service = new CoreSessionService(store, {
				sessionArtifactsDir: sessionsDir,
			});
			const rootSessionId = "nested-live-root-session";
			await service.createRootSessionWithArtifacts({
				sessionId: rootSessionId,
				source: SessionSource.CLI,
				pid: process.pid,
				interactive: false,
				provider: "mock-provider",
				model: "mock-model",
				cwd: "/tmp/project",
				workspaceRoot: "/tmp/project",
				enableTools: true,
				enableSpawn: true,
				enableTeams: true,
				prompt: "live root",
				startedAt: "2026-01-01T00:00:00.000Z",
			});

			const adapter = (
				service as unknown as { adapter: SessionPersistenceAdapter }
			).adapter;
			await adapter.upsertSession(
				makeSubagentRow({
					sessionId: "nested-live-mid-subagent",
					parentSessionId: rootSessionId,
					startedAt: "2026-01-01T00:00:01.000Z",
				}),
			);
			await adapter.upsertSession(
				makeSubagentRow({
					sessionId: "nested-live-leaf-subagent",
					parentSessionId: "nested-live-mid-subagent",
					startedAt: "2026-01-01T00:00:02.000Z",
				}),
			);

			// Even with the root's artifacts missing, nothing is pruned while
			// the root session process is alive: the leaf's liveness check must
			// walk through the terminated mid subagent up to the live root.
			rmSync(join(sessionsDir, rootSessionId), {
				recursive: true,
				force: true,
			});
			await expect(service.reconcileMissingArtifactSessions(10)).resolves.toBe(
				0,
			);
			expect(
				store.queryAll(`SELECT session_id FROM sessions ORDER BY session_id`),
			).toHaveLength(3);
		},
	);

	sqliteIt(
		"deletes a session when compaction sidecar cleanup fails",
		async () => {
			const dbDir = mkdtempSync(join(tmpdir(), "delete-sidecar-fail-db-"));
			const sessionsDir = mkdtempSync(
				join(tmpdir(), "delete-sidecar-fail-sessions-"),
			);
			tempDirs.push(dbDir, sessionsDir);

			const store = new SqliteSessionStore({ sessionsDir: dbDir });
			stores.push(store);
			const service = new CoreSessionService(store, {
				sessionArtifactsDir: sessionsDir,
			});
			const sessionId = "sidecar-delete-fail-session";
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
				prompt: "delete me",
				startedAt: "2026-04-10T19:00:00.000Z",
			});
			const manifestStore = (
				service as unknown as {
					manifestStore: {
						deleteSessionCompactionState: (sessionId: string) => Promise<void>;
					};
				}
			).manifestStore;
			const deleteSidecar = vi
				.spyOn(manifestStore, "deleteSessionCompactionState")
				.mockRejectedValue(new Error("sidecar busy"));

			const result = await service.deleteSession(sessionId);

			expect(result).toEqual({ deleted: true });
			await expect(service.listSessions(10)).resolves.not.toEqual(
				expect.arrayContaining([expect.objectContaining({ sessionId })]),
			);
			expect(deleteSidecar).toHaveBeenCalledWith(sessionId);
		},
	);
});
