import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteSessionStore } from "../storage/sqlite-session-store";
import { SessionSource } from "../types/common";
import { CoreSessionService } from "./session-service";

describe("UnifiedSessionPersistenceService", () => {
	const tempDirs: string[] = [];
	const stores: Array<SqliteSessionStore> = [];

	afterEach(() => {
		for (const store of stores.splice(0)) {
			store.close();
		}
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reconciles dead running sessions into failed manifests with terminal markers", async () => {
		const sessionsDir = mkdtempSync(join(tmpdir(), "stale-session-reconcile-"));
		tempDirs.push(sessionsDir);

		const store = new SqliteSessionStore({ sessionsDir });
		stores.push(store);
		const service = new CoreSessionService(store);
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

		expect(existsSync(artifacts.hookPath)).toBe(true);
		expect(existsSync(artifacts.transcriptPath)).toBe(true);
		expect(readFileSync(artifacts.hookPath, "utf8")).toContain(
			'"hookName":"session_shutdown"',
		);
		expect(readFileSync(artifacts.hookPath, "utf8")).toContain(
			'"reason":"failed_external_process_exit"',
		);
		expect(readFileSync(artifacts.transcriptPath, "utf8")).toContain(
			"[shutdown] failed_external_process_exit",
		);
	}, 15_000);

	it("persists teammate task metadata in the file envelope and usage on messages", async () => {
		const sessionsDir = mkdtempSync(join(tmpdir(), "team-task-messages-"));
		tempDirs.push(sessionsDir);

		const store = new SqliteSessionStore({ sessionsDir });
		stores.push(store);
		const service = new CoreSessionService(store);
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
		const path = join(
			sessionsDir,
			rootSessionId,
			"java-haiku-agent__" +
				teammateSessionId?.slice(teammateSessionId?.lastIndexOf("__") + 2) +
				".messages.json",
		);
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
		const row = childSessions.find(
			(item) => item.sessionId === teammateSessionId,
		);
		expect(row?.messagesPath).toBe(path);
		expect(row?.transcriptPath).toBe(
			join(
				sessionsDir,
				rootSessionId,
				"java-haiku-agent__" +
					teammateSessionId?.slice(teammateSessionId?.lastIndexOf("__") + 2) +
					".log",
			),
		);
	});
});
