import type { AgentToolContext } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import type { ScheduleTaskInput } from "../schemas";
import {
	createScheduleTaskExecutor,
	type ScheduleTaskCreateInput,
} from "./schedule-task";

function ctx(sessionId?: string): AgentToolContext {
	return { agentId: "agent-1", iteration: 0, sessionId };
}

function baseInput(
	overrides: Partial<ScheduleTaskInput> = {},
): ScheduleTaskInput {
	return {
		name: "Daily summary",
		prompt: "Summarize activity",
		schedule: "0 9 * * *",
		...overrides,
	};
}

describe("createScheduleTaskExecutor", () => {
	it("defaults deliverTo to new_session and records originSessionId in metadata", async () => {
		const createSchedule = vi.fn(async (_input: ScheduleTaskCreateInput) => ({
			scheduleId: "sched_1",
			nextRunAt: 1_000,
		}));
		const executor = createScheduleTaskExecutor({
			client: { createSchedule },
			defaults: { workspaceRoot: "/repo", cwd: "/repo/app" },
		});

		const result = await executor(baseInput(), ctx("origin-1"));

		expect(createSchedule).toHaveBeenCalledTimes(1);
		const call = createSchedule.mock.calls[0][0];
		expect(call.name).toBe("Daily summary");
		expect(call.cronPattern).toBe("0 9 * * *");
		expect(call.workspaceRoot).toBe("/repo");
		expect(call.cwd).toBe("/repo/app");
		expect(call.createdBy).toBe("agent");
		expect(call.originSessionId).toBe("origin-1");
		expect(call.metadata).toMatchObject({
			deliveryMode: "new_session",
			originSessionId: "origin-1",
		});
		expect(result).toContain("sched_1");
		expect(result).toContain("new_session");
	});

	it("passes deliveryMode=origin_session through metadata", async () => {
		const createSchedule = vi.fn(async () => ({ scheduleId: "sched_2" }));
		const executor = createScheduleTaskExecutor({
			client: { createSchedule },
			defaults: { workspaceRoot: "/repo" },
		});

		await executor(baseInput({ deliverTo: "origin_session" }), ctx("origin-2"));

		const call = createSchedule.mock.calls[0][0];
		expect(call.metadata?.deliveryMode).toBe("origin_session");
		expect(call.metadata?.originSessionId).toBe("origin-2");
	});

	it("attaches the connector delivery descriptor when provided", async () => {
		const createSchedule = vi.fn(async () => ({ scheduleId: "sched_3" }));
		const executor = createScheduleTaskExecutor({
			client: { createSchedule },
			defaults: { workspaceRoot: "/repo" },
			connectorDelivery: { adapter: "telegram", threadId: "telegram:42" },
		});

		await executor(baseInput({ deliverTo: "connector" }), ctx("origin-3"));

		const call = createSchedule.mock.calls[0][0];
		expect(call.metadata?.deliveryMode).toBe("connector");
		expect(call.metadata?.delivery).toEqual({
			adapter: "telegram",
			threadId: "telegram:42",
		});
	});

	it("leaves delivery unset for connector mode when no descriptor is provided (host resolves it)", async () => {
		const createSchedule = vi.fn(async () => ({ scheduleId: "sched_4" }));
		const executor = createScheduleTaskExecutor({
			client: { createSchedule },
			defaults: { workspaceRoot: "/repo" },
		});

		await executor(baseInput({ deliverTo: "connector" }), ctx("origin-4"));

		const call = createSchedule.mock.calls[0][0];
		expect(call.metadata?.deliveryMode).toBe("connector");
		expect(call.metadata?.delivery).toBeUndefined();
	});

	it("prefers explicit workspaceRoot/cwd from the tool input over defaults", async () => {
		const createSchedule = vi.fn(async () => ({ scheduleId: "sched_5" }));
		const executor = createScheduleTaskExecutor({
			client: { createSchedule },
			defaults: { workspaceRoot: "/repo", cwd: "/repo" },
		});

		await executor(
			baseInput({ workspaceRoot: "/other", cwd: "/other/pkg" }),
			ctx("origin-5"),
		);

		const call = createSchedule.mock.calls[0][0];
		expect(call.workspaceRoot).toBe("/other");
		expect(call.cwd).toBe("/other/pkg");
	});

	it("records the timezone in metadata when provided", async () => {
		const createSchedule = vi.fn(async () => ({ scheduleId: "sched_6" }));
		const executor = createScheduleTaskExecutor({
			client: { createSchedule },
			defaults: { workspaceRoot: "/repo" },
		});

		await executor(
			baseInput({ timezone: "America/New_York" }),
			ctx("origin-6"),
		);

		const call = createSchedule.mock.calls[0][0];
		expect(call.metadata?.timezone).toBe("America/New_York");
	});
});
