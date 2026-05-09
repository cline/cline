import type { Message } from "@clinebot/shared";
import { describe, expect, it } from "vitest";
import { deriveForkSessionTitle } from "./title";

describe("deriveForkSessionTitle", () => {
	it("appends a fork suffix to the source title", () => {
		expect(
			deriveForkSessionTitle({
				sourceTitle: "Investigate history picker",
				messages: [],
			}),
		).toBe("Investigate history picker (fork)");
	});

	it("keeps appending fork suffixes for repeated forks", () => {
		expect(
			deriveForkSessionTitle({
				sourceTitle: "Investigate history picker (fork)",
				messages: [],
			}),
		).toBe("Investigate history picker (fork) (fork)");
	});

	it("derives the fork title from the first user message when needed", () => {
		const messages = [
			{
				role: "user",
				content: '<user_input mode="act">Fix the CLI history UX</user_input>',
			},
			{
				role: "assistant",
				content: "Working on it.",
			},
		] satisfies Message[];

		expect(
			deriveForkSessionTitle({
				messages,
			}),
		).toBe("Fix the CLI history UX (fork)");
	});

	it("preserves the fork suffix when truncating long titles", () => {
		const title = deriveForkSessionTitle({
			sourceTitle: "a".repeat(200),
			messages: [],
		});

		expect(title).toHaveLength(120);
		expect(title.endsWith(" (fork)")).toBe(true);
	});
});
