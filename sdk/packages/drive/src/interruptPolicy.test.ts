import { describe, expect, it } from "vitest";
import {
	classifyInterrupt,
	decideReviseOrRestart,
} from "./interruptPolicy";

describe("classifyInterrupt", () => {
	it("degrades empty intent to stop + pause-after-tool while in flight", () => {
		expect(
			classifyInterrupt({ intent: null, turnInFlight: true }),
		).toEqual({
			intent: "stop",
			action: "pause-after-tool",
			revise: "revise",
		});
	});

	it("maps clarify/redirect to queue-steer with revise", () => {
		expect(
			classifyInterrupt({
				intent: "clarify",
				gist: "why that file?",
				turnInFlight: true,
			}),
		).toMatchObject({ action: "queue-steer", revise: "revise" });
		expect(
			classifyInterrupt({
				intent: "redirect",
				gist: "try the other approach",
				turnInFlight: true,
			}),
		).toMatchObject({ action: "queue-steer", revise: "revise" });
	});

	it("degrades clarify/redirect without gist to fresh + restart", () => {
		expect(
			classifyInterrupt({
				intent: "redirect",
				gist: "  ",
				turnInFlight: true,
			}),
		).toEqual({
			intent: "fresh",
			action: "pause-after-tool",
			revise: "restart",
		});
	});

	it("hard-cancel restarts immediately", () => {
		expect(
			classifyInterrupt({
				intent: "stop",
				turnInFlight: true,
				hardCancel: true,
			}),
		).toEqual({
			intent: "stop",
			action: "hard-cancel",
			revise: "restart",
		});
	});
});

describe("decideReviseOrRestart", () => {
	it("defaults to revise-not-restart", () => {
		expect(decideReviseOrRestart({})).toBe("revise");
		expect(decideReviseOrRestart({ explicitRestart: true })).toBe(
			"restart",
		);
		expect(decideReviseOrRestart({ hardCancel: true })).toBe("restart");
	});
});
