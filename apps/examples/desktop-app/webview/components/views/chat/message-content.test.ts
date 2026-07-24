import { describe, expect, test } from "vitest";
import { formatChatMessageContent } from "./message-content";

describe("formatChatMessageContent", () => {
	test("unwraps transport envelopes only for user messages", () => {
		expect(
			formatChatMessageContent(
				"user",
				"  <user_input>\nPlease fix the tests\n</user_input>  ",
			),
		).toBe("Please fix the tests");
	});

	test("preserves assistant examples that contain transport tags", () => {
		const content =
			"<user_input>\nThis tag is part of the explanation.\n</user_input>";
		expect(formatChatMessageContent("assistant", content)).toBe(content);
	});

	test("preserves assistant mode notices instead of stripping them", () => {
		const content = "<mode_notice>\nPlan mode details\n</mode_notice>";
		expect(formatChatMessageContent("assistant", content)).toBe(content);
	});

	test("trims outer whitespace for non-user roles", () => {
		expect(formatChatMessageContent("error", "  Request failed  \n")).toBe(
			"Request failed",
		);
	});
});
