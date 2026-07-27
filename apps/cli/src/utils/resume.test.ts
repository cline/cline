import { describe, expect, it, vi } from "vitest";
import { loadInteractiveResumeMessages } from "./resume";

describe("loadInteractiveResumeMessages", () => {
	it("returns undefined when session id is missing", async () => {
		const manager = {
			readMessages: vi.fn().mockResolvedValue([]),
		};
		const result = await loadInteractiveResumeMessages(manager as never);
		expect(result).toBeUndefined();
		expect(manager.readMessages).not.toHaveBeenCalled();
	});

	it("loads messages through session manager readMessages", async () => {
		const expected = [
			{ role: "user", content: [{ type: "text", text: "resume" }] },
		];
		const manager = {
			readMessages: vi.fn().mockResolvedValue(expected),
		};
		const result = await loadInteractiveResumeMessages(
			manager as never,
			" session-123 ",
		);
		expect(manager.readMessages).toHaveBeenCalledWith("session-123");
		expect(result).toEqual(expected);
	});
});
