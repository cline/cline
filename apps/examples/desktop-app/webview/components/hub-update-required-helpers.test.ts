import { describe, expect, it } from "vitest";
import {
	describeOutdatedHubSessions,
	resolveHubUpdateRestartDecision,
} from "./hub-update-required-helpers";

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
