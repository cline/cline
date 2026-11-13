import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool, ScheduleRecord } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import type { StartSessionInput } from "../../runtime/host/runtime-host";
import type { SessionRecord } from "../../types/sessions";
import { HubServerTransport } from "./hub-server-transport";

vi.mock("@ai-sdk/provider-utils", () => ({
	createProviderDefinedToolFactory: vi.fn(() => vi.fn()),
}));

describe("schedule result Hub integration", () => {
	it("creates a schedule through the agent tool and reports its output in the original saved conversation", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-schedule-result-"));
		const workspace = realpathSync.native(root);
		const previousClineDir = process.env.CLINE_DIR;
		process.env.CLINE_DIR = join(root, "cline-home");
		mkdirSync(process.env.CLINE_DIR);
		let tasksTool: AgentTool | undefined;
		let active = false;
		const session: SessionRecord = {
			sessionId: "origin",
			source: "core",
			startedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			status: "idle",
			interactive: true,
			provider: "test",
			model: "test",
			cwd: workspace,
			workspaceRoot: workspace,
			enableTools: true,
			enableSpawn: false,
			enableTeams: false,
			isSubagent: false,
			metadata: { mode: "act" },
		};
		const startSession = vi.fn(async (input: StartSessionInput) => {
			tasksTool = input.localRuntime?.extraTools?.find(
				(tool) => tool.name === "tasks",
			);
			active = true;
			return {
				sessionId: "origin",
				manifest: {},
				manifestPath: "",
				messagesPath: "",
			};
		});
		const runTurn = vi.fn(
			async (input: { sessionId: string; prompt: string }) => {
				if (!active) throw new Error("Destination runtime was not restored");
				expect(input.sessionId).toBe("origin");
				return {
					text: "Here is the CI result",
					iterations: 1,
					finishReason: "completed",
					toolCalls: [],
					usage: { inputTokens: 1, outputTokens: 1 },
				};
			},
		);
		const scheduledSend = vi.fn(async () => ({
			result: {
				text: "CI passed",
				usage: { inputTokens: 1, outputTokens: 1 },
				toolCalls: [],
			},
		}));
		const transport = new HubServerTransport({
			workspaceRoot: workspace,
			sessionHost: {
				startSession,
				runTurn,
				getSession: vi.fn(async (id) =>
					id === "origin" ? session : undefined,
				),
				listSessions: vi.fn(async () => [session]),
				readSessionMessages: vi.fn(async () => [
					{ role: "user", content: "Check CI and report back here" },
				]),
				readSessionCompactionState: vi.fn(async () => undefined),
				subscribe: vi.fn(() => () => {}),
				dispose: vi.fn(async () => {}),
			} as never,
			runtimeHandlers: {
				startSession: vi.fn(async () => ({ sessionId: "scheduled-worker" })),
				sendSession: scheduledSend,
				stopSession: vi.fn(async () => ({ applied: true })),
				abortSession: vi.fn(async () => ({ applied: true })),
			},
			scheduleOptions: {
				dbPath: join(root, "cron.db"),
				specs: { cronSpecsDir: join(root, "reports") },
			},
			taskOptions: {
				dbPath: join(root, "tasks.db"),
				globalSpecsDir: join(root, "tasks"),
				watchFiles: false,
			},
			runQueue: { dbPath: join(root, "runs.db") },
			eventLog: false,
		});
		try {
			await transport.start();
			await transport.handleCommand({
				version: "v1",
				command: "session.create",
				clientId: "desktop",
				payload: {
					metadata: { interactive: true },
					sessionConfig: {
						sessionId: "origin",
						providerId: "test",
						modelId: "test",
						cwd: workspace,
						workspaceRoot: workspace,
					},
				},
			});
			expect(tasksTool).toBeDefined();
			if (!tasksTool) throw new Error("Expected tasks tool");
			const context = { sessionId: "origin", agentId: "lead", iteration: 1 };
			const created = (await tasksTool.execute(
				{
					kind: "scheduled",
					operation: "create",
					name: "CI check",
					schedule_type: "once",
					run_at: new Date(Date.now() + 60_000).toISOString(),
					prompt: "Check CI",
					delivery: "current_session",
				},
				context,
			)) as { ok: boolean; schedule: ScheduleRecord };
			expect(created.ok).toBe(true);
			const forged = await transport.handleCommand({
				version: "v1",
				command: "schedule.create",
				clientId: "desktop",
				payload: {
					metadata: { __hubScheduleResultSessionId: "other-session" },
				},
			});
			expect(forged).toMatchObject({
				ok: false,
				error: {
					message: "Result destinations must be captured by the tasks tool",
				},
			});

			expect(created.schedule.metadata?.__hubScheduleResultSessionId).toBe(
				"origin",
			);
			const runAt = created.schedule.metadata?.__hubScheduleRunAt;
			for (const delivery of ["new_session", "current_session"] as const) {
				const updated = (await tasksTool.execute(
					{
						kind: "scheduled",
						operation: "update",
						schedule_id: created.schedule.scheduleId,
						delivery,
					},
					context,
				)) as { ok: boolean; schedule: ScheduleRecord };
				expect(updated.ok).toBe(true);
				expect(updated.schedule.metadata?.__hubScheduleRunAt).toBe(runAt);
				expect(updated.schedule.metadata?.__hubScheduleResultSessionId).toBe(
					delivery === "current_session" ? "origin" : null,
				);
			}
			active = false;
			await tasksTool.execute(
				{
					kind: "scheduled",
					operation: "run_now",
					schedule_id: created.schedule.scheduleId,
				},
				context,
			);
			await expect.poll(() => runTurn.mock.calls.length).toBe(1);
			expect(startSession).toHaveBeenLastCalledWith(
				expect.objectContaining({
					resumeExistingSession: true,
					initialMessages: [
						{ role: "user", content: "Check CI and report back here" },
					],
					config: expect.objectContaining({ sessionId: "origin" }),
				}),
			);
			expect(runTurn).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: expect.stringContaining("CI passed"),
					delivery: "immediate",
				}),
			);
			expect(scheduledSend).toHaveBeenCalledOnce();
			const runs = await transport.handleCommand({
				version: "v1",
				command: "run.list",
				sessionId: "origin",
				payload: {},
			});
			expect(runs.payload?.runs).toEqual([
				expect.objectContaining({ sessionId: "origin", state: "completed" }),
			]);
		} finally {
			await transport.stop();
			if (previousClineDir === undefined) delete process.env.CLINE_DIR;
			else process.env.CLINE_DIR = previousClineDir;
			rmSync(root, { recursive: true, force: true });
		}
	});
});
