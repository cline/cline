import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	HubScheduleCreateInput,
	HubScheduleUpdateInput,
	ScheduleRecord,
} from "@cline/shared";
import {
	ONE_TIME_SCHEDULE_CRON_PATTERN,
	ONE_TIME_SCHEDULE_RUN_AT_METADATA_KEY,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	type AgentScheduleServiceApi,
	executeScheduleOperation,
	type ScheduledTaskInput,
	type ScheduleTaskOperationOptions,
} from "./schedule-tool";

const WORKSPACE_ROOT = process.cwd();
const OTHER_WORKSPACE_ROOT = tmpdir();

function schedule(overrides: Partial<ScheduleRecord> = {}): ScheduleRecord {
	return {
		scheduleId: "sched_1",
		name: "Morning review",
		cronPattern: "0 9 * * 1-5",
		timezone: "America/Los_Angeles",
		prompt: "Review open pull requests.",
		workspaceRoot: WORKSPACE_ROOT,
		cwd: WORKSPACE_ROOT,
		modelSelection: { providerId: "cline", modelId: "model-1" },
		enabled: true,
		mode: "yolo",
		maxParallel: 1,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		...overrides,
	};
}

function serviceMock(): AgentScheduleServiceApi {
	return {
		createSchedule: vi.fn((input: HubScheduleCreateInput) =>
			schedule({
				name: input.name,
				cronPattern: input.cronPattern,
				timezone: input.timezone,
				prompt: input.prompt,
				workspaceRoot: input.workspaceRoot,
				cwd: input.cwd,
				modelSelection: input.modelSelection,
				createdBy: input.createdBy,
				metadata: input.metadata,
			}),
		),
		getSchedule: vi.fn(() => schedule()),
		listSchedules: vi.fn(() => []),
		updateSchedule: vi.fn(
			(_scheduleId: string, updates: HubScheduleUpdateInput) =>
				schedule({
					cronPattern: updates.cronPattern ?? "0 9 * * 1-5",
					timezone:
						updates.timezone === null
							? undefined
							: (updates.timezone ?? "America/Los_Angeles"),
					metadata: updates.metadata,
				}),
		),
		deleteSchedule: vi.fn(() => true),
		pauseSchedule: vi.fn(() => schedule({ enabled: false })),
		resumeSchedule: vi.fn(() => schedule({ enabled: true })),
		triggerScheduleNowDetached: vi.fn(() => ({
			executionId: "exec_1",
			scheduleId: "sched_1",
			triggeredAt: Date.now(),
			status: "pending" as const,
		})),
	};
}

const context = {
	sessionId: "session_1",
	agentId: "agent_1",
	iteration: 1,
};

function scheduleOperations(options: ScheduleTaskOperationOptions) {
	return {
		execute: (input: ScheduledTaskInput, toolContext = context) =>
			executeScheduleOperation(options, input, toolContext),
	};
}

describe("schedule agent tool", () => {
	it("creates a one-time schedule using current session defaults", async () => {
		const schedules = serviceMock();
		const publish = vi.fn();
		const capture = vi.fn();
		const tool = scheduleOperations({
			schedules,
			publish,
			telemetry: { capture } as never,
			resolveSessionDefaults: async () => ({
				workspaceRoot: WORKSPACE_ROOT,
				cwd: WORKSPACE_ROOT,
				modelSelection: { providerId: "cline", modelId: "model-current" },
				interactive: true,
			}),
		});

		const result = await tool.execute(
			{
				operation: "create",
				schedule_type: "once",
				name: "Check CI",
				prompt: "Check CI for PR #42 and summarize any failures.",
				run_at: "2035-01-02T17:30:00-08:00",
			},
			context,
		);

		expect(result).toMatchObject({ ok: true, operation: "create" });
		expect(capture).toHaveBeenCalledWith({
			event: "task.tool_used",
			properties: expect.objectContaining({
				tool: "tasks.scheduled.create",
				success: true,
			}),
		});
		expect(schedules.createSchedule).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "Check CI",
				cronPattern: ONE_TIME_SCHEDULE_CRON_PATTERN,
				workspaceRoot: WORKSPACE_ROOT,
				cwd: WORKSPACE_ROOT,
				modelSelection: {
					providerId: "cline",
					modelId: "model-current",
				},
				createdBy: "agent:agent_1",
				metadata: {
					[ONE_TIME_SCHEDULE_RUN_AT_METADATA_KEY]: Date.parse(
						"2035-01-02T17:30:00-08:00",
					),
				},
			}),
		);
		expect(publish).toHaveBeenCalledWith(
			"schedule.created",
			{ schedule: expect.objectContaining({ name: "Check CI" }) },
			"session_1",
		);
	});

	it("creates timezone-aware recurring schedules and filters list results", async () => {
		const schedules = serviceMock();
		vi.mocked(schedules.listSchedules).mockReturnValue([
			schedule({ scheduleId: "mine", workspaceRoot: WORKSPACE_ROOT }),
			schedule({
				scheduleId: "other",
				workspaceRoot: OTHER_WORKSPACE_ROOT,
			}),
		]);
		const tool = scheduleOperations({
			schedules,
			resolveSessionDefaults: async () => ({
				workspaceRoot: WORKSPACE_ROOT,
				interactive: true,
			}),
		});

		await tool.execute(
			{
				operation: "create",
				schedule_type: "recurring",
				name: "Weekday review",
				prompt: "Review open pull requests.",
				cron_pattern: "0 9 * * 1-5",
				timezone: "America/Los_Angeles",
			},
			context,
		);
		expect(schedules.createSchedule).toHaveBeenCalledWith(
			expect.objectContaining({
				cronPattern: "0 9 * * 1-5",
				timezone: "America/Los_Angeles",
			}),
		);

		await expect(
			tool.execute({ operation: "list" }, context),
		).resolves.toMatchObject({
			ok: true,
			schedules: [expect.objectContaining({ scheduleId: "mine" })],
		});
		expect(schedules.listSchedules).toHaveBeenCalledWith(
			expect.objectContaining({ workspaceRoot: WORKSPACE_ROOT, limit: 50 }),
		);
	});

	it("blocks cross-workspace and unattended mutations", async () => {
		const schedules = serviceMock();
		vi.mocked(schedules.getSchedule)
			.mockReturnValueOnce(schedule({ workspaceRoot: OTHER_WORKSPACE_ROOT }))
			.mockReturnValueOnce(
				schedule({ workspaceRoot: WORKSPACE_ROOT, cwd: OTHER_WORKSPACE_ROOT }),
			);
		const interactiveTool = scheduleOperations({
			schedules,
			resolveSessionDefaults: async () => ({
				workspaceRoot: WORKSPACE_ROOT,
				interactive: true,
			}),
		});
		expect(
			await interactiveTool.execute(
				{ operation: "pause", schedule_id: "outside" },
				context,
			),
		).toMatchObject({
			ok: false,
			error: { code: "schedule_operation_failed" },
		});
		expect(schedules.pauseSchedule).not.toHaveBeenCalled();
		expect(
			await interactiveTool.execute(
				{ operation: "run_now", schedule_id: "outside-cwd" },
				context,
			),
		).toMatchObject({
			ok: false,
			error: { code: "schedule_operation_failed" },
		});
		expect(schedules.triggerScheduleNowDetached).not.toHaveBeenCalled();

		const unattendedTool = scheduleOperations({
			schedules,
			resolveSessionDefaults: async () => ({
				workspaceRoot: WORKSPACE_ROOT,
				interactive: false,
			}),
		});
		expect(
			await unattendedTool.execute(
				{
					operation: "create",
					schedule_type: "recurring",
					name: "Recursive schedule",
					prompt: "Do more work.",
					cron_pattern: "0 * * * *",
				},
				context,
			),
		).toMatchObject({
			ok: false,
			error: {
				message: "schedule mutations require an interactive user session",
			},
		});
		expect(schedules.createSchedule).not.toHaveBeenCalled();
	});

	it("rejects a symlink and parent-segment workspace escape", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-schedule-scope-"));
		try {
			const sessionWorkspace = join(root, "workspace");
			const outside = join(root, "outside");
			const outsideNested = join(outside, "nested");
			mkdirSync(sessionWorkspace);
			mkdirSync(outside);
			mkdirSync(outsideNested);
			mkdirSync(join(outside, "workspace"));
			const link = join(root, "link");
			symlinkSync(
				outsideNested,
				link,
				process.platform === "win32" ? "junction" : "dir",
			);
			// Lexical normalization maps this to sessionWorkspace, while native
			// filesystem traversal follows link before applying the parent segment.
			const escapingWorkspace = `${link}/../workspace`;
			const schedules = serviceMock();
			vi.mocked(schedules.getSchedule).mockReturnValueOnce(
				schedule({ workspaceRoot: escapingWorkspace }),
			);
			const tool = scheduleOperations({
				schedules,
				resolveSessionDefaults: async () => ({
					workspaceRoot: sessionWorkspace,
					interactive: true,
				}),
			});

			expect(
				await tool.execute(
					{ operation: "run_now", schedule_id: "escaping" },
					context,
				),
			).toMatchObject({
				ok: false,
				error: { code: "schedule_operation_failed" },
			});
			expect(schedules.triggerScheduleNowDetached).not.toHaveBeenCalled();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
