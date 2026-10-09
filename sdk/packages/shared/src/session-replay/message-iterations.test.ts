import { describe, expect, it } from "vitest";
import type { MessageWithMetadata } from "../llms/messages";
import {
	groupSessionMessageIterations,
	isSessionModelCallMessage,
} from "./message-iterations";

const user = (text: string): MessageWithMetadata => ({
	role: "user",
	content: text,
});
const assistant = (
	text: string,
	metadata?: Record<string, unknown>,
): MessageWithMetadata => ({
	role: "assistant",
	content: [{ type: "text", text }],
	...(metadata ? { metadata } : {}),
});
const toolResult = (id: string): MessageWithMetadata => ({
	role: "user",
	content: [
		{ type: "tool_result", tool_use_id: id, name: "tool", content: "ok" },
	],
});

describe("groupSessionMessageIterations", () => {
	it("groups each model call with the prompt before it and the tool results after it", () => {
		const messages = [
			user("hi"),
			assistant("calling"),
			toolResult("a"),
			toolResult("b"),
			assistant("done"),
			user("next"),
			assistant("ok"),
		];
		expect(groupSessionMessageIterations(messages)).toEqual([
			{ start: 0, end: 4, assistantIndex: 1 },
			{ start: 4, end: 5, assistantIndex: 4 },
			{ start: 5, end: 7, assistantIndex: 6 },
		]);
	});

	it("attaches display-only assistant notices to the current iteration", () => {
		const messages = [
			user("hi"),
			assistant("calling"),
			assistant("failed", { displayOnly: true, displayRole: "error" }),
		];
		expect(groupSessionMessageIterations(messages)).toEqual([
			{ start: 0, end: 3, assistantIndex: 1 },
		]);
	});

	it("keeps an unanswered trailing prompt as its own group", () => {
		expect(
			groupSessionMessageIterations([user("a"), assistant("b"), user("c")]),
		).toEqual([
			{ start: 0, end: 2, assistantIndex: 1 },
			{ start: 2, end: 3 },
		]);
	});
});

describe("isSessionModelCallMessage", () => {
	it("excludes display-only and non-conversational assistant messages", () => {
		expect(isSessionModelCallMessage(assistant("x"))).toBe(true);
		expect(
			isSessionModelCallMessage(assistant("x", { displayOnly: true })),
		).toBe(false);
		expect(
			isSessionModelCallMessage(assistant("x", { displayRole: "status" })),
		).toBe(false);
		expect(isSessionModelCallMessage(user("x"))).toBe(false);
	});
});
