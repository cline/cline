import type { TeamProgressProjectionEvent } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	createTaskUpdateFingerprint,
	findBindingForSessionId,
	formatConnectorTaskUpdate,
} from "./task-updates";

function createProjection(
	overrides: Partial<TeamProgressProjectionEvent["lastEvent"]> = {},
): TeamProgressProjectionEvent {
	return {
		type: "team_progress_projection",
		version: 1,
		sessionId: "session-1",
		summary: {
			teamName: "telegram-team",
			updatedAt: "2026-03-18T00:00:00.000Z",
			members: {
				total: 2,
				byStatus: { idle: 0, running: 2, stopped: 0 },
				leadCount: 1,
				teammateCount: 1,
			},
			tasks: {
				total: 3,
				byStatus: {
					pending: 0,
					in_progress: 1,
					blocked: 0,
					completed: 2,
				},
				blockedTaskIds: [],
				readyTaskIds: [],
				completionPct: 67,
			},
			runs: {
				total: 1,
				byStatus: {
					queued: 0,
					running: 1,
					completed: 0,
					failed: 0,
					cancelled: 0,
					interrupted: 0,
				},
				activeRunIds: ["run-1"],
				latestRunId: "run-1",
			},
			outcomes: {
				total: 0,
				byStatus: { draft: 0, in_review: 0, finalized: 0 },
				finalizedPct: 0,
				missingRequiredSections: [],
			},
			fragments: {
				total: 0,
				byStatus: { draft: 0, reviewed: 0, rejected: 0 },
			},
		},
		lastEvent: {
			teamName: "telegram-team",
			sessionId: "session-1",
			eventType: "run_progress",
			ts: "2026-03-18T00:00:00.000Z",
			runId: "run-1",
			taskId: "task-1",
			agentId: "agent-1",
			message: "Investigating failing test and patching the connector relay.",
			...overrides,
		},
	};
}

describe("connector task updates", () => {
	it("finds a binding by session id in either binding slot", () => {
		const bindings = {
			thread_a: {
				channelId: "channel-a",
				isDM: true,
				serializedThread: "{}",
				sessionId: "session-a",
				updatedAt: "2026-03-18T00:00:00.000Z",
			},
			thread_b: {
				channelId: "channel-b",
				isDM: false,
				serializedThread: "{}",
				state: { sessionId: "session-b" },
				updatedAt: "2026-03-18T00:00:00.000Z",
			},
		};

		expect(findBindingForSessionId(bindings, "session-a")?.threadId).toBe(
			"thread_a",
		);
		expect(findBindingForSessionId(bindings, "session-b")?.threadId).toBe(
			"thread_b",
		);
	});

	it("formats run progress updates for chat delivery", () => {
		expect(formatConnectorTaskUpdate(createProjection())).toBe(
			[
				"[telegram-team] Task update",
				"Investigating failing test and patching the connector relay.",
				"1 run active | 1 task in progress | 2/3 tasks complete",
			].join("\n"),
		);
	});

	it("suppresses generic task update noise when nothing is in progress", () => {
		const projection = createProjection({
			eventType: "team_task_updated",
			message: undefined,
		});
		projection.summary.tasks.byStatus.in_progress = 0;

		expect(formatConnectorTaskUpdate(projection)).toBeUndefined();
	});

	it("changes the fingerprint when the progress payload changes", () => {
		const first = createProjection();
		const second = createProjection({
			message: "Finished the patch and validating the CLI adapters now.",
		});

		expect(createTaskUpdateFingerprint(first)).not.toBe(
			createTaskUpdateFingerprint(second),
		);
	});
});
