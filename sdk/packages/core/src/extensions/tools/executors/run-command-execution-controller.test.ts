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
		expect(successfulDetach).toHaveBeenCalledWith("user");
		expect(otherSessionDetach).not.toHaveBeenCalled();
	});

	it("fans detached completion out to host listeners", () => {
		const controller = new RunCommandExecutionController();
		const listener = vi.fn();
		const unsubscribe =
			controller.subscribeToDetachedCommandCompleted(listener);
		const event = {
			sessionId: "session-1",
			executionId: "execution-1",
			toolCallId: "call-1",
			logPath: "/tmp/output.log",
			detachKind: "implicit" as const,
			outcome: { kind: "exited" as const, exitCode: 0 },
			ts: 123,
		};

		controller.reportDetachedCommandCompleted(event);
		expect(listener).toHaveBeenCalledWith(event);

		unsubscribe();
		controller.reportDetachedCommandCompleted(event);
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("reports each detached execution completion once", () => {
		const controller = new RunCommandExecutionController();
		const listener = vi.fn();
		controller.subscribeToDetachedCommandCompleted(listener);
		const event = {
			sessionId: "session-1",
			executionId: "execution-1",
			logPath: "/tmp/output.log",
			detachKind: "implicit" as const,
			outcome: { kind: "exited" as const, exitCode: 0 },
			ts: 1,
		};
		controller.reportDetachedCommandCompleted(event);
		controller.reportDetachedCommandCompleted(event);
		expect(listener).toHaveBeenCalledOnce();
	});
});
