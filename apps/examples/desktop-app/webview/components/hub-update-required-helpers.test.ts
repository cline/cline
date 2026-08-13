import { describe, expect, it } from "vitest";
import { resolveHubUpdateRestartDecision } from "./hub-update-required-helpers";

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
