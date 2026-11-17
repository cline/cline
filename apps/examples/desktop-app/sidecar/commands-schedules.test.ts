import {
	ONE_TIME_SCHEDULE_CRON_PATTERN,
	ONE_TIME_SCHEDULE_RUN_AT_METADATA_KEY,
} from "@cline/shared/browser";
import { describe, expect, it, vi } from "vitest";
import { handleCommand } from "./commands";
import type { SidecarContext } from "./types";

const scheduleArgs = {
	schedule_id: "schedule-1",
	name: "Daily summary",
	prompt: "Summarize new pull requests.",
	cron_pattern: "0 9 * * *",
	workspace_root: "/workspace/project",
};
const runAt = Date.UTC(2030, 0, 1, 9);

function context() {
	const schedule = { scheduleId: "schedule-1" };
	const command = vi
		.fn()
		.mockResolvedValue({ ok: true, payload: { schedule } });
	const ctx = {
		runtimeBindings: new Map([["local", { hubClient: { command } }]]),
	} as unknown as SidecarContext;
	return { ctx, command, schedule };
}

describe("desktop schedule description commands", () => {
	it.each([
		["create_routine_schedule", "schedule.create"],
		["update_routine_schedule", "schedule.update"],
	] as const)("passes the description through %s without copying stale metadata", async (name, hubCommand) => {
		const { ctx, command, schedule } = context();
		await expect(
			handleCommand(ctx, name, {
				...scheduleArgs,
				description: "  Summarize the team's open pull requests.  ",
				metadata: { description: "Stale description", unrelated: "Stale data" },
			}),
		).resolves.toEqual({ schedule });
		expect(command).toHaveBeenCalledExactlyOnceWith(
			hubCommand,
			expect.objectContaining({
				allWorkspaces: true,
				cronPattern: scheduleArgs.cron_pattern,
				metadata: { description: "Summarize the team's open pull requests." },
			}),
		);
	});

	it.each([
		["create_routine_schedule", "schedule.create", "One-time project summary"],
		["update_routine_schedule", "schedule.update", ""],
	] as const)("preserves one-time timing and explicit descriptions in %s", async (name, hubCommand, description) => {
		const { ctx, command } = context();
		await handleCommand(ctx, name, {
			...scheduleArgs,
			schedule_type: "once",
			run_at: runAt,
			description,
		});
		expect(command).toHaveBeenCalledExactlyOnceWith(
			hubCommand,
			expect.objectContaining({
				cronPattern: ONE_TIME_SCHEDULE_CRON_PATTERN,
				metadata: {
					[ONE_TIME_SCHEDULE_RUN_AT_METADATA_KEY]: runAt,
					description,
				},
			}),
		);
	});

	it.each([
		"create_routine_schedule",
		"update_routine_schedule",
	] as const)("leaves description metadata untouched for old recurring callers of %s", async (name) => {
		const { ctx, command } = context();
		await handleCommand(ctx, name, scheduleArgs);
		expect(command).toHaveBeenCalledOnce();
		expect(command.mock.calls[0]?.[1]).not.toHaveProperty("metadata");
	});

	it("updates one-time timing without overwriting an omitted description", async () => {
		const { ctx, command } = context();
		await handleCommand(ctx, "update_routine_schedule", {
			...scheduleArgs,
			schedule_type: "once",
			run_at: runAt,
		});
		expect(command).toHaveBeenCalledExactlyOnceWith(
			"schedule.update",
			expect.objectContaining({
				metadata: { [ONE_TIME_SCHEDULE_RUN_AT_METADATA_KEY]: runAt },
			}),
		);
	});
});
