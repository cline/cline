import { TeamMessageType } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import type { ActiveSession } from "../../types/session";
import {
	dispatchTeamEventToBackend,
	resolveTurnContinuation,
} from "./team-session-coordinator";

function sessionWith(input: {
	interactive?: boolean;
	aborting?: boolean;
	activeTeamRuns?: number;
}): ActiveSession {
	return {
		interactive: input.interactive ?? true,
		aborting: input.aborting ?? false,
		config: { enableAgentTeams: true },
		activeTeamRunIds: new Set(
			Array.from({ length: input.activeTeamRuns ?? 0 }, (_, i) => `run-${i}`),
		),
		pendingTeamRunUpdates: [],
	} as unknown as ActiveSession;
}

describe("resolveTurnContinuation", () => {
	it("continues with teammate results before queued prompts", () => {
		expect(
			resolveTurnContinuation(
				sessionWith({ activeTeamRuns: 1 }),
				"completed",
				2,
			),
		).toBe("team_runs");
	});

	it("continues with a queued prompt once teammates are done", () => {
		expect(resolveTurnContinuation(sessionWith({}), "completed", 1)).toBe(
			"queued_prompt",
		);
		expect(resolveTurnContinuation(sessionWith({}), "aborted", 1)).toBe(
			"queued_prompt",
		);
	});

	it("ends the turn when nothing follows the run", () => {
		expect(resolveTurnContinuation(sessionWith({}), "completed", 0)).toBe(
			undefined,
		);
	});

	it("leaves queued prompts queued after a failed run", () => {
		expect(resolveTurnContinuation(sessionWith({}), "failed", 1)).toBe(
			undefined,
		);
	});

	it("does not auto-continue an aborting session on teammate results", () => {
		expect(
			resolveTurnContinuation(
				sessionWith({ aborting: true, activeTeamRuns: 1 }),
				"aborted",
				0,
			),
		).toBe(undefined);
	});

	it("never continues a non-interactive run with queued prompts", () => {
		expect(
			resolveTurnContinuation(
				sessionWith({ interactive: false }),
				"completed",
				1,
			),
		).toBe(undefined);
	});
});

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
