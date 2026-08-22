import type { AgentMessage } from "@cline/shared/agent";
import { describe, expect, it } from "vitest";
import { projectMessageToChatEvents } from "./chat-events";

function message(
	role: AgentMessage["role"],
	content: AgentMessage["content"],
): AgentMessage {
	return {
		id: "message_1",
		role,
		content,
		createdAt: 1,
	};
}

describe("Gateway message chat projection", () => {
	it("preserves assistant text ordering and emits a tool start", () => {
		expect(
			projectMessageToChatEvents(
				message("assistant", [
					{ type: "text", text: "Checking." },
					{
						type: "tool-call",
						toolCallId: "call_1",
						toolName: "run_commands",
						input: { commands: ["pwd"] },
					},
				]),
			),
		).toEqual([
			{ stream: "chat_text", chunk: "Checking." },
			{
				stream: "chat_tool_call_start",
				chunk: JSON.stringify({
					toolCallId: "call_1",
					toolName: "run_commands",
					input: { commands: ["pwd"] },
				}),
			},
		]);
	});

	it("emits the matching successful and failed tool results", () => {
		expect(
			projectMessageToChatEvents(
				message("tool", [
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "run_commands",
						output: { stdout: "/workspace" },
					},
					{
						type: "tool-result",
						toolCallId: "call_2",
						toolName: "run_commands",
						output: { error: "denied" },
						isError: true,
					},
				]),
			),
		).toEqual([
			{
				stream: "chat_tool_call_end",
				chunk: JSON.stringify({
					toolCallId: "call_1",
					toolName: "run_commands",
					output: { stdout: "/workspace" },
				}),
			},
			{
				stream: "chat_tool_call_end",
				chunk: JSON.stringify({
					toolCallId: "call_2",
					toolName: "run_commands",
					output: { error: "denied" },
					error: "denied",
				}),
			},
		]);
	});
});
