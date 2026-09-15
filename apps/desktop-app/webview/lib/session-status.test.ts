import { describe, expect, it } from "vitest";
import { sessionStatusColor, sessionStatusTone } from "@/lib/session-status";

describe("sessionStatusTone", () => {
	it("marks running sessions as running", () => {
		expect(sessionStatusTone("running")).toBe("running");
	});

	it("marks failed and error sessions as errors", () => {
		expect(sessionStatusTone("failed")).toBe("error");
		expect(sessionStatusTone("error")).toBe("error");
	});

	it("treats every other status as neutral", () => {
		for (const status of [
			"idle",
			"starting",
			"stopping",
			"pending",
			"completed",
			"cancelled",
			undefined,
		]) {
			expect(sessionStatusTone(status)).toBe("neutral");
		}
	});
});

describe("sessionStatusColor", () => {
	it("uses one color per tone", () => {
		expect(sessionStatusColor("running")).toBe("var(--color-green-500)");
		expect(sessionStatusColor("failed")).toBe("var(--color-red-500)");
		expect(sessionStatusColor("completed")).toBe("var(--color-gray-500)");
	});
});
