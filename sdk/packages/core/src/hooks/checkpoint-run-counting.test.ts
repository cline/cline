import type { AgentMessage } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	countGenuineUserPromptMessages,
	isGenuineUserPromptMessage,
} from "./checkpoint-run-counting";

function message(
	role: AgentMessage["role"],
	metadata?: Record<string, unknown>,
): AgentMessage {
	return {
		id: "m",
		role,
		content: [{ type: "text", text: "x" }],
		createdAt: 0,
		...(metadata ? { metadata } : {}),
	};
}

describe("isGenuineUserPromptMessage (AgentMessage)", () => {
	it("accepts a plain user message", () => {
		expect(isGenuineUserPromptMessage(message("user"))).toBe(true);
	});

	it("rejects assistant and tool roles", () => {
		expect(isGenuineUserPromptMessage(message("assistant"))).toBe(false);
		expect(isGenuineUserPromptMessage(message("tool"))).toBe(false);
	});

	it("rejects a completion-tool reminder message", () => {
		expect(
			isGenuineUserPromptMessage(
				message("user", { kind: "completion_reminder" }),
			),
		).toBe(false);
	});

	it("accepts a genuinely queued/steered user message", () => {
		// consumePendingUserMessage() pushes an untagged role:"user" message -
		// it must keep counting as a real turn.
		expect(isGenuineUserPromptMessage(message("user"))).toBe(true);
	});
});

describe("countGenuineUserPromptMessages (AgentMessage)", () => {
	it("ignores tool-role messages and tagged synthetic reminders", () => {
		const messages: AgentMessage[] = [
			message("user"),
			message("assistant"),
			message("tool"),
			message("assistant"),
			message("user", { kind: "completion_reminder" }),
			message("user", { kind: "completion_reminder" }),
			message("user"),
		];

		expect(countGenuineUserPromptMessages(messages)).toBe(2);
	});
});
