import { afterEach, describe, expect, it, vi } from "vitest";
import {
	describeHubRestartInterruption,
	isPersistableHubMismatchKey,
	persistHubCapabilityNoticeDismissal,
	readHubCapabilityNoticeDismissal,
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

describe("the plugin suggestions notice", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function stubStorage(): Map<string, string> {
		const entries = new Map<string, string>();
		return Object.assign(entries, {
			getItem: (key: string) => entries.get(key) ?? null,
			setItem: (key: string, value: string) => {
				entries.set(key, value);
			},
		});
	}

	it("never blocks, even with an app update staged", () => {
		for (const state of [
			"idle",
			"checking",
			"downloading",
			"ready",
			"error",
			undefined,
		] as const) {
			expect(shouldShowHubMismatchDialog("missing_capability", state)).toBe(
				false,
			);
		}
	});

	it("keeps Not now for this app run only, apart from the dialog's Later", () => {
		const local = stubStorage();
		const session = stubStorage();
		vi.stubGlobal("localStorage", local);
		vi.stubGlobal("sessionStorage", session);

		persistHubCapabilityNoticeDismissal("missing_capability:source-0.0.93");

		expect(readHubCapabilityNoticeDismissal()).toBe(
			"missing_capability:source-0.0.93",
		);
		expect(local.size).toBe(0);
		expect(isPersistableHubMismatchKey("missing_capability:abc")).toBe(false);
	});

	it("forgets Not now when storage is unavailable", () => {
		vi.stubGlobal("sessionStorage", {
			getItem: () => {
				throw new Error("storage disabled");
			},
			setItem: () => {
				throw new Error("storage disabled");
			},
		});

		expect(() =>
			persistHubCapabilityNoticeDismissal("missing_capability:abc"),
		).not.toThrow();
		expect(readHubCapabilityNoticeDismissal()).toBeNull();
	});

	it("words the interruption from a fresh reading, this app included", () => {
		expect(
			describeHubRestartInterruption({
				activeSessionCount: 3,
				participantClientCount: 2,
			}),
		).toBe(
			"The Hub is serving 3 active sessions from 2 connected Cline clients, including any in this app. Restarting interrupts their work in progress.",
		);
		expect(describeHubRestartInterruption({ activeSessionCount: 1 })).toBe(
			"The Hub is serving 1 active session, including any in this app. Restarting interrupts their work in progress.",
		);
	});

	it("still states the cost when the Hub could not be read", () => {
		expect(describeHubRestartInterruption(null)).toBe(
			"Cline couldn't check what the Hub is serving. Restarting interrupts any work in progress in Cline apps that use the Hub, including this one.",
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
