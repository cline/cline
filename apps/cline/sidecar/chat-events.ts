import type { AgentMessage, AgentMessagePart } from "@cline/shared/agent";

export type ProjectedChatEvent = {
	stream:
		| "chat_text"
		| "chat_reasoning"
		| "chat_tool_call_start"
		| "chat_tool_call_end";
	chunk: string;
};

function errorText(output: unknown): string {
	if (typeof output === "string") return output;
	if (output && typeof output === "object") {
		const error = (output as { error?: unknown }).error;
		if (typeof error === "string") return error;
	}
	try {
		return JSON.stringify(output);
	} catch {
		return String(output);
	}
}

/**
 * Project durable Gateway messages onto the desktop's live chat stream.
 *
 * The Gateway message log is canonical. Using it for tool lifecycle events
 * keeps reconnects and approvals coherent: an assistant tool-call message is
 * the start, and the matching tool-result message is the finish.
 */
export function projectMessageToChatEvents(
	message: Pick<AgentMessage, "role" | "content">,
): ProjectedChatEvent[] {
	const events: ProjectedChatEvent[] = [];
	for (const part of message.content as readonly AgentMessagePart[]) {
		if (message.role === "assistant" && part.type === "text" && part.text) {
			events.push({ stream: "chat_text", chunk: part.text });
			continue;
		}
		if (
			message.role === "assistant" &&
			part.type === "reasoning" &&
			part.text
		) {
			events.push({
				stream: "chat_reasoning",
				chunk: JSON.stringify({
					text: part.text,
					...(part.redacted ? { redacted: true } : {}),
				}),
			});
			continue;
		}
		if (message.role === "assistant" && part.type === "tool-call") {
			events.push({
				stream: "chat_tool_call_start",
				chunk: JSON.stringify({
					toolCallId: part.toolCallId,
					toolName: part.toolName,
					input: part.input,
				}),
			});
			continue;
		}
		if (message.role === "tool" && part.type === "tool-result") {
			events.push({
				stream: "chat_tool_call_end",
				chunk: JSON.stringify({
					toolCallId: part.toolCallId,
					toolName: part.toolName,
					output: part.output,
					...(part.isError ? { error: errorText(part.output) } : {}),
				}),
			});
		}
	}
	return events;
}
