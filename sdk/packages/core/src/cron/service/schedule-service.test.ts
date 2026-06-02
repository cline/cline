import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HubScheduleCommandService } from "./schedule-command-service";
import { HubScheduleService } from "./schedule-service";

const require = createRequire(import.meta.url);
const sqliteAvailable = (() => {
	try {
		require("node:sqlite");
		return true;
	} catch {
		return false;
	}
})();

// The first SQLite-backed test in a file pays a one-time cost: loading the
// native `node:sqlite` module and creating the first temp database file. On
// Windows CI this cold start can exceed Vitest's default 5 s timeout, so give
// these tests extra headroom.
const SQLITE_TEST_TIMEOUT_MS = 30_000;

async function createTempDbPath(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "sdk-hub-schedule-"));
	return join(directory, "cron.db");
}

const cleanupPaths: string[] = [];

afterEach(async () => {
	await Promise.all(
		cleanupPaths.splice(0).map(async (dbPath) => {
			await rm(dirname(dbPath), { recursive: true, force: true });
		}),
	);
});

describe("HubScheduleService", () => {
	const sqliteIt = sqliteAvailable ? it : it.skip;

	sqliteIt(
		"creates, triggers, and reports schedule history",
		async () => {
			const dbPath = await createTempDbPath();
			cleanupPaths.push(dbPath);
			const publishedEvents: Array<{
				eventType: string;
				payload: Record<string, unknown>;
			}> = [];
			const service = new HubScheduleService({
				dbPath,
				runtimeHandlers: {
					startSession: vi.fn(async () => ({ sessionId: "session-1" })),
					sendSession: vi.fn(async () => ({
						result: {
							text: "done",
							iterations: 3,
							inputTokens: 10,
							outputTokens: 20,
							usage: { totalCost: 1.25 },
						},
					})),
					abortSession: vi.fn(async () => ({ applied: true })),
					stopSession: vi.fn(async () => ({ applied: true })),
				},
				eventPublisher: (eventType, payload) => {
					publishedEvents.push({ eventType, payload });
				},
			});
			try {
				const created = service.createSchedule({
					name: "Routine",
					cronPattern: "0 * * * *",
					prompt: "Run the routine",
					workspaceRoot: "/workspace",
					cwd: "/workspace",
					modelSelection: {
						providerId: "openai",
						modelId: "gpt-5.3-codex",
					},
					maxParallel: 1,
					timeoutSeconds: 30,
					metadata: { delivery: { threadId: "thread-1" } },
				});

				const execution = await service.triggerScheduleNow(created.scheduleId);
				expect(execution?.status).toBe("success");
				expect(execution?.sessionId).toBe("session-1");
				expect(publishedEvents).toEqual([
					{
						eventType: "schedule.execution.completed",
						payload: expect.objectContaining({
							scheduleId: created.scheduleId,
							executionId: execution?.executionId,
							sessionId: "session-1",
							status: "success",
						}),
					},
				]);

				const schedule = service.getSchedule(created.scheduleId);
				expect(schedule?.metadata).toEqual({
					delivery: { threadId: "thread-1" },
				});
				expect(
					service.listScheduleExecutions({ scheduleId: created.scheduleId }),
				).toHaveLength(1);
				expect(service.getScheduleStats(created.scheduleId).totalRuns).toBe(1);
				expect(service.getUpcomingRuns(10)).toHaveLength(1);
			} finally {
				await service.dispose();
			}
		},
		SQLITE_TEST_TIMEOUT_MS,
	);

	sqliteIt(
		"publishes failed schedule execution events",
		async () => {
			const dbPath = await createTempDbPath();
			cleanupPaths.push(dbPath);
			const publishedEvents: Array<{
				eventType: string;
				payload: Record<string, unknown>;
			}> = [];
			const service = new HubScheduleService({
				dbPath,
				runtimeHandlers: {
					startSession: vi.fn(async () => ({ sessionId: "session-failed" })),
					sendSession: vi.fn(async () => {
						throw new Error("runtime failed");
					}),
					abortSession: vi.fn(async () => ({ applied: true })),
					stopSession: vi.fn(async () => ({ applied: true })),
				},
				eventPublisher: (eventType, payload) => {
					publishedEvents.push({ eventType, payload });
				},
			});
			try {
				const created = service.createSchedule({
					name: "Failure routine",
					cronPattern: "0 * * * *",
					prompt: "Run and fail",
					workspaceRoot: "/workspace",
					modelSelection: {
						providerId: "openai",
						modelId: "gpt-5.3-codex",
					},
				});

				const execution = await service.triggerScheduleNow(created.scheduleId);
				expect(execution?.status).toBe("failed");
				expect(publishedEvents).toEqual([
					{
						eventType: "schedule.execution.failed",
						payload: expect.objectContaining({
							scheduleId: created.scheduleId,
							executionId: execution?.executionId,
							sessionId: "session-failed",
							status: "failed",
							errorMessage: "runtime failed",
						}),
					},
				]);
			} finally {
				await service.dispose();
			}
		},
		SQLITE_TEST_TIMEOUT_MS,
	);

	sqliteIt(
		"handles schedule commands through the hub command adapter",
		async () => {
			const dbPath = await createTempDbPath();
			cleanupPaths.push(dbPath);
			const service = new HubScheduleService({
				dbPath,
				runtimeHandlers: {
					startSession: vi.fn(async () => ({ sessionId: "session-2" })),
					sendSession: vi.fn(async () => ({ result: { text: "done" } })),
					abortSession: vi.fn(async () => ({ applied: true })),
					stopSession: vi.fn(async () => ({ applied: true })),
				},
			});
			try {
				const commands = new HubScheduleCommandService(service);

				const createdReply = await commands.handleCommand({
					version: "v1",
					command: "schedule.create",
					payload: {
						name: "Command routine",
						cronPattern: "15 * * * *",
						prompt: "Run from command",
						workspaceRoot: "/workspace",
						modelSelection: {
							providerId: "openai",
							modelId: "gpt-5.3-codex",
						},
					},
				});
				expect(createdReply.ok).toBe(true);
				const created = createdReply.payload?.schedule as {
					scheduleId: string;
				};

				const listReply = await commands.handleCommand({
					version: "v1",
					command: "schedule.list",
					payload: { limit: 10 },
				});
				expect(listReply.ok).toBe(true);
				expect(
					(listReply.payload?.schedules as Array<{ scheduleId: string }>).some(
						(item) => item.scheduleId === created.scheduleId,
					),
				).toBe(true);
			} finally {
				await service.dispose();
			}
		},
		SQLITE_TEST_TIMEOUT_MS,
	);
});
