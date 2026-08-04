import { describe, expect, it } from "vitest";
import { SessionRunInProgressError } from "../orchestration/session-runtime-orchestrator";
import {
	isSessionNotFoundError,
	isUnusableSessionError,
	SessionNotFoundError,
} from "./runtime-host";

describe("isUnusableSessionError", () => {
	it("matches a missing session", () => {
		expect(isUnusableSessionError(new SessionNotFoundError("sess_1"))).toBe(
			true,
		);
		expect(
			isUnusableSessionError(
				Object.assign(new Error("session not found: sess_1"), {
					code: "session_not_found",
				}),
			),
		).toBe(true);
	});

	it("matches a session wedged on a run that never drained", () => {
		expect(
			isUnusableSessionError(new SessionRunInProgressError("agent_1")),
		).toBe(true);
	});

	it("matches the wedged-run error by message once the code is gone", () => {
		// Errors reaching a connector have crossed the hub's JSON boundary, which
		// leaves only the message — and hub and CLI are often different versions.
		expect(
			isUnusableSessionError(
				new Error(
					"SessionRuntime.shutdown called while a run is in progress (agentId=agent_1)",
				),
			),
		).toBe(true);
		expect(
			isUnusableSessionError({
				message:
					"SessionRuntime.shutdown called while a run is in progress (agentId=agent_1)",
			}),
		).toBe(true);
	});

	it("leaves ordinary run failures alone", () => {
		// Replacing the session would hide a real error and lose the conversation.
		expect(isUnusableSessionError(new Error("provider returned 500"))).toBe(
			false,
		);
		expect(isUnusableSessionError(new Error("aborted by user"))).toBe(false);
		expect(isUnusableSessionError(undefined)).toBe(false);
		expect(isUnusableSessionError("some string")).toBe(false);
	});

	it("keeps the narrower missing-session check narrow", () => {
		// Callers that specifically mean "the hub forgot this session" must not
		// start matching wedged runtimes.
		expect(
			isSessionNotFoundError(new SessionRunInProgressError("agent_1")),
		).toBe(false);
	});
});

describe("SessionRunInProgressError", () => {
	it("carries a stable code and keeps the original message", () => {
		const error = new SessionRunInProgressError("agent_1");

		expect(error.code).toBe("session_run_in_progress");
		expect(error.message).toBe(
			"SessionRuntime.shutdown called while a run is in progress (agentId=agent_1)",
		);
		expect(error).toBeInstanceOf(Error);
	});

	it("reads sensibly without an agent id", () => {
		expect(new SessionRunInProgressError().message).toBe(
			"SessionRuntime.shutdown called while a run is in progress",
		);
	});
});
