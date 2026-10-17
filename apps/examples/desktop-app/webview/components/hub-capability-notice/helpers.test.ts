import { afterEach, describe, expect, it, vi } from "vitest";
import {
	isPersistableHubMismatchKey,
	shouldShowHubMismatchDialog,
} from "../hub-update-required-helpers";
import {
	describeHubRestartInterruption,
	persistHubCapabilityNoticeDismissal,
	readHubCapabilityNoticeDismissal,
} from "./helpers";

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
