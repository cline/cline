import { describe, expect, it } from "vitest";
import { startsNewThread } from "./work-in-selection";

describe("startsNewThread", () => {
	it("is true for an empty thread", () => {
		expect(startsNewThread(null, [])).toBe(true);
		expect(startsNewThread(undefined, [])).toBe(true);
	});

	it("stays true after a failed first launch left only an error behind", () => {
		// The optimistic user message is withdrawn on failure; the error
		// message the hook appends is not accepted conversation.
		expect(
			startsNewThread(null, [
				{ role: "error" },
				{ role: "status" },
				{ role: "system" },
			]),
		).toBe(true);
	});

	it("is false once a session exists or a prompt was accepted", () => {
		expect(startsNewThread("session-1", [])).toBe(false);
		expect(startsNewThread(null, [{ role: "user" }])).toBe(false);
		expect(
			startsNewThread(null, [{ role: "error" }, { role: "assistant" }]),
		).toBe(false);
	});
});
