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

	test("projects a clean monitor resume notice for display", () => {
		const content =
			"<system-reminder>\n" +
			"Resuming this session rebuilt its runtime and stopped an active monitor: ci (mon_1). " +
			"They are no longer running. Tell the user if that affects the current task, and start replacements only if they are still needed and approved.\n" +
			"[monitor mon_1 stopped because session resumed]\n" +
			"[monitor mon_2 stopped because session resumed]\n" +
			"</system-reminder>";
		const display = formatChatMessageContent(
			"system",
			content,
			"monitor_resume_notice",
		);
		expect(display).toBe(
			"Resuming this session rebuilt its runtime and stopped an active monitor: ci (mon_1). " +
				"They are no longer running. Tell the user if that affects the current task, and start replacements only if they are still needed and approved.",
		);
	});

	test("keeps envelopes for system messages of other kinds", () => {
		const content = "<system-reminder>\nRecovered\n</system-reminder>";
		expect(formatChatMessageContent("system", content, "recovery_notice")).toBe(
			content,
		);
	});
});
