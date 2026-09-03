import { describe, expect, it } from "vitest";
import {
	describeOutdatedHubSessions,
	isPersistableHubMismatchKey,
	resolveHubUpdateRestartDecision,
	retainDismissalForIncomingMismatch,
	shouldShowHubMismatchDialog,
} from "./hub-update-required-helpers";

describe("shouldShowHubMismatchDialog", () => {
	it("always allows the truly-broken and blocking reasons", () => {
		for (const state of [
			"idle",
			"checking",
			"downloading",
			"ready",
			"error",
			undefined,
		] as const) {
			expect(shouldShowHubMismatchDialog("unsupported_protocol", state)).toBe(
				true,
			);
			expect(shouldShowHubMismatchDialog("outdated_hub", state)).toBe(true);
		}
	});

	it("persists dismissals only for the advisory build_mismatch case", () => {
		expect(isPersistableHubMismatchKey("build_mismatch:abc123")).toBe(true);
		expect(isPersistableHubMismatchKey("unsupported_protocol:abc123")).toBe(
			false,
		);
		expect(isPersistableHubMismatchKey("outdated_hub:abc123")).toBe(false);
		expect(isPersistableHubMismatchKey(null)).toBe(false);
		expect(isPersistableHubMismatchKey("")).toBe(false);
	});

	it("reopens a dismissed protocol warning on redelivery, keeps advisory and unrelated dismissals", () => {
		// A replayed unsupported_protocol mismatch clears its own dismissal:
		// the app cannot talk to that Hub, so "Later" must not outlive an
		// in-place reconnect replay.
		expect(
			retainDismissalForIncomingMismatch(
				"unsupported_protocol:abc",
				"unsupported_protocol:abc",
			),
		).toBeNull();
		// The advisory newer-hub dismissal stands across replays.
		expect(
			retainDismissalForIncomingMismatch(
				"build_mismatch:abc",
				"build_mismatch:abc",
			),
		).toBe("build_mismatch:abc");
		// A dismissal for a different mismatch is untouched.
		expect(
			retainDismissalForIncomingMismatch(
				"build_mismatch:abc",
				"unsupported_protocol:def",
			),
		).toBe("build_mismatch:abc");
		expect(retainDismissalForIncomingMismatch(null, "build_mismatch:abc")).toBe(
			null,
		);
	});

	it("allows a newer-hub prompt only once an app update is staged", () => {
		expect(shouldShowHubMismatchDialog("build_mismatch", "ready")).toBe(true);
		for (const state of [
			"idle",
			"checking",
			"downloading",
			"error",
			undefined,
		] as const) {
			expect(shouldShowHubMismatchDialog("build_mismatch", state)).toBe(false);
		}
	});
});

describe("describeOutdatedHubSessions", () => {
	it("quantifies sessions and clients when the hub reported both", () => {
		expect(
			describeOutdatedHubSessions({
				activeSessionCount: 2,
				participantClientCount: 1,
			}),
		).toBe("2 active sessions from 1 connected Cline client");
		expect(
			describeOutdatedHubSessions({
				activeSessionCount: 1,
				participantClientCount: 3,
			}),
		).toBe("1 active session from 3 connected Cline clients");
	});

	it("omits the client clause when participant ids were unavailable", () => {
		expect(
			describeOutdatedHubSessions({
				activeSessionCount: 4,
				participantClientCount: 0,
			}),
		).toBe("4 active sessions");
	});

	it("falls back to an unquantified phrase when the hub could not answer", () => {
		expect(describeOutdatedHubSessions({})).toBe(
			"active sessions from other Cline clients",
		);
	});
});

describe("resolveHubUpdateRestartDecision", () => {
	it("restarts only once an update is staged", () => {
		expect(resolveHubUpdateRestartDecision({ state: "ready" })).toEqual({
			action: "restart",
		});
	});

	it("stays open when no update is available, so the app is not relaunched into the same version", () => {
		for (const state of ["idle", "checking", "downloading"] as const) {
			const decision = resolveHubUpdateRestartDecision({ state });
			expect(decision.action).toBe("stay");
		}
	});

	it("stays open and surfaces the failure when the update check errors", () => {
		const decision = resolveHubUpdateRestartDecision({
			state: "error",
			error: "endpoint unreachable",
		});
		expect(decision).toEqual({
			action: "stay",
			hint: "The update check failed: endpoint unreachable",
		});
	});

	it("stays open when the check could not run at all (web mode or bridge failure)", () => {
		expect(resolveHubUpdateRestartDecision(null).action).toBe("stay");
	});
});
