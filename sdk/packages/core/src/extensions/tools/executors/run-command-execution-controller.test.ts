import { describe, expect, it, vi } from "vitest";
import { RunCommandExecutionController } from "./run-command-execution-controller";

describe("RunCommandExecutionController", () => {
	it("continues detaching matching commands after one command fails", () => {
		const controller = new RunCommandExecutionController();
		const successfulDetach = vi.fn(() => true);
		const otherSessionDetach = vi.fn(() => true);
		controller.register({
			executionId: "failing",
			sessionId: "session-1",
			toolCallId: "call-1",
			detach: () => {
				throw new Error("log unavailable");
			},
		});
		controller.register({
			executionId: "successful",
			sessionId: "session-1",
			toolCallId: "call-1",
			detach: successfulDetach,
		});
		controller.register({
			executionId: "other-session",
			sessionId: "session-2",
			toolCallId: "call-1",
			detach: otherSessionDetach,
		});

		expect(controller.proceedWhileRunning("session-1", "call-1")).toBe(1);
		expect(successfulDetach).toHaveBeenCalledOnce();
		expect(otherSessionDetach).not.toHaveBeenCalled();
	});
});
