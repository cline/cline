import { describe, expect, it } from "vitest";
import { isChatForkSession } from "./chatForkSession";

describe("isChatForkSession", () => {
	it("detects chatFork metadata", () => {
		expect(isChatForkSession({ chatFork: true })).toBe(true);
		expect(isChatForkSession({ isSubagent: true })).toBe(true);
		expect(isChatForkSession({ source: "hub" })).toBe(false);
		expect(isChatForkSession(null)).toBe(false);
	});
});
