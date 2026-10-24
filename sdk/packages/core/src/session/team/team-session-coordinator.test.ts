import { TeamMessageType } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamEvent } from "../../extensions/tools/team";
import type { CoreSessionEvent } from "../../types/events";
import type { ActiveSession } from "../../types/session";
import {
	dispatchTeamEventToBackend,
	emitTeamProgress,
	TEAM_PROGRESS_TELEMETRY_THROTTLE_MS,
} from "./team-session-coordinator";

describe("dispatchTeamEventToBackend", () => {
	it("persists intentionally aborted teammate tasks as cancelled", async () => {
		const invokeOptional = vi.fn(async () => {});
		const error = new DOMException("This operation was aborted", "AbortError");

		await dispatchTeamEventToBackend(
			"root-session",
			{
				type: TeamMessageType.TaskEnd,
				agentId: "teammate-1",
				status: "cancelled",
				error,
				messages: [],
			},
			invokeOptional,
		);

		expect(invokeOptional).toHaveBeenCalledWith(
			"onTeamTaskEnd",
			"root-session",
			"teammate-1",
			"cancelled",
			"[done] aborted",
			undefined,
			[],
		);
	});
});

function fakeSession(): ActiveSession {
	const state = {
		teamId: "team-1",
		teamName: "team-1",
		members: [],
		tasks: [],
		mailbox: [],
		missionLog: [],
		runs: [],
		outcomes: [],
		outcomeFragments: [],
	};
	return {
		runtime: {
			teamRuntime: {
				getTeamName: () => "team-1",
				exportState: () => state,
			},
		},
	} as unknown as ActiveSession;
}

const run = { id: "run-1", agentId: "reviewer" };

const agentEvent = {
	type: TeamMessageType.AgentEvent,
	agentId: "reviewer",
	event: { type: "content_start", contentType: "text", text: "…" },
} as unknown as TeamEvent;

const progress = (message: string) =>
	({ type: TeamMessageType.RunProgress, run, message }) as unknown as TeamEvent;

function lifecycleMessages(events: CoreSessionEvent[]) {
	return events.map((event) =>
		event.type === "team_progress"
			? [event.payload.lifecycle.eventType, event.payload.lifecycle.message]
			: [event.type],
	);
}

describe("emitTeamProgress throttling", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("sends run activity immediately and throttles streamed events", () => {
		const session = fakeSession();
		const emitted: CoreSessionEvent[] = [];
		let now = 10_000;
		const emit = (event: TeamEvent) =>
			emitTeamProgress(
				session,
				"root",
				event,
				(e) => emitted.push(e),
				() => now,
			);

		emit(agentEvent);
		now += 100;
		emit(progress("running_tool_editor"));
		now += 100;
		emit(agentEvent);
		emit(progress("heartbeat"));
		vi.advanceTimersByTime(TEAM_PROGRESS_TELEMETRY_THROTTLE_MS);

		expect(lifecycleMessages(emitted)).toEqual([
			["agent_event", undefined],
			["run_progress", "running_tool_editor"],
			["run_progress", "heartbeat"],
		]);
	});

	it("delivers both ends of a tool call and drops the superseded stream", () => {
		const session = fakeSession();
		const emitted: CoreSessionEvent[] = [];
		let now = 10_000;
		const emit = (event: TeamEvent) =>
			emitTeamProgress(
				session,
				"root",
				event,
				(e) => emitted.push(e),
				() => now,
			);

		emit(agentEvent);
		now += 100;
		emit(agentEvent);
		now += 100;
		emit(progress("running_tool_read_files"));
		now += 100;
		emit(progress("finished_tool_read_files"));
		vi.advanceTimersByTime(TEAM_PROGRESS_TELEMETRY_THROTTLE_MS);

		expect(lifecycleMessages(emitted)).toEqual([
			["agent_event", undefined],
			["run_progress", "running_tool_read_files"],
			["run_progress", "finished_tool_read_files"],
		]);
	});
});
