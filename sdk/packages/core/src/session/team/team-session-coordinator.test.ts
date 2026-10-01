import { TeamMessageType } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { dispatchTeamEventToBackend } from "./team-session-coordinator";

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
