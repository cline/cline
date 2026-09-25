import { describe, expect, it } from "vitest";
import {
	normalizeSessionTitle,
	resolveSessionListTitle,
} from "./session-title";

describe("session list titles", () => {
	it("keeps explicit-title precedence, multiline content and the 70-character cap", () => {
		const title = "First line\n" + "x".repeat(90);
		const metadata = { title };
		expect(
			resolveSessionListTitle({
				sessionId: "abcdef",
				metadata,
				prompt: "ignored",
			}),
		).toBe(title.slice(0, 70));
		expect(metadata.title).toBe(title);
		expect(normalizeSessionTitle("x".repeat(130))).toHaveLength(120);
	});

	it("formats wrapped prompts and uses their first line before messages", () => {
		expect(
			resolveSessionListTitle({
				sessionId: "abcdef",
				prompt: "<user_input>Fix this\nDetails</user_input>",
				messages: [{ role: "user", content: "Other" }],
			}),
		).toBe("Fix this");
	});

	it("uses text blocks from the first usable user message, then assistant text", () => {
		const messages = [
			{ role: "assistant", content: "Assistant fallback" },
			{
				role: "user",
				content: [
					{ type: "image" },
					{ type: "tool_result", content: "tool output" },
					{ type: "thinking", thinking: "private" },
				],
			},
		];
		expect(resolveSessionListTitle({ sessionId: "abcdef", messages })).toBe(
			"Assistant fallback",
		);
		messages.push({ role: "user", content: "  Useful user text\nDetails  " });
		expect(resolveSessionListTitle({ sessionId: "abcdef", messages })).toBe(
			"Useful user text",
		);
	});

	it("joins text blocks without letting malformed or non-text blocks become titles", () => {
		expect(
			resolveSessionListTitle({
				sessionId: "abcdef",
				messages: [
					null,
					[],
					{
						role: "user",
						content: [
							null,
							{ type: "text", text: 42 },
							{ type: "image", text: "not text" },
							{ type: "text", text: "x".repeat(80) },
							{ type: "text", text: "second" },
						],
					},
				],
			}),
		).toBe("x".repeat(70));
	});

	it.each([
		undefined,
		null,
		{},
		{ title: 42 },
		{ title: "  " },
	])("falls back safely for metadata %j", (metadata) => {
		expect(
			resolveSessionListTitle({
				sessionId: "session-abcdef",
				metadata,
				prompt: " ",
				messages: [{ role: "user", content: [{ type: "image" }] }],
			}),
		).toBe("Session abcdef");
	});
});
