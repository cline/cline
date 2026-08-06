import type {
	AgentSideConnection,
	SessionUpdate,
} from "@agentclientprotocol/sdk";
import {
	type ContentBlock,
	formatDisplayUserInput,
	type Message,
	type ToolResultContent,
} from "@cline/shared";
import { ACT_MODE_CONTINUATION_PROMPT } from "../runtime/interactive/mode";
import { buildToolTitle, mapToolKind } from "./tool-utils";

/**
 * The act-mode continuation prompt is runtime-generated, not typed by the
 * user, so it must not replay as a user turn. Mirrors the TUI transcript
 * hydration filter in tui/utils/hydrate-messages.ts.
 */
function isSyntheticUserText(text: string): boolean {
	return text === ACT_MODE_CONTINUATION_PROMPT;
}

/**
 * Replay a persisted conversation to the client as session/update
 * notifications. Used by `session/load` — the ACP spec requires the entire
 * conversation to be replayed before the load request resolves, so each
 * notification is awaited.
 */
export async function replaySessionHistory(
	conn: AgentSideConnection,
	sessionId: string,
	messages: Message[],
): Promise<void> {
	for (const message of messages) {
		for (const update of translateHistoricalMessage(message)) {
			await conn.sessionUpdate({ sessionId, update });
		}
	}
}

export function translateHistoricalMessage(message: Message): SessionUpdate[] {
	const blocks: ContentBlock[] =
		typeof message.content === "string"
			? [{ type: "text", text: message.content }]
			: message.content;

	const updates: SessionUpdate[] = [];

	for (const block of blocks) {
		switch (block.type) {
			case "text": {
				if (!block.text) break;
				if (message.role !== "user") {
					updates.push({
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: block.text },
					});
					break;
				}
				// Display boundary: persisted user text keeps its runtime-generated
				// <user_input mode="..."> wrapper and <mode_notice> elements (they are
				// the durable record of the mode each turn was sent in). Replaying them
				// verbatim leaks markup to the client, which renders the unknown
				// element as bare text — so `s` shows up as `s` with the wrapper
				// swallowed. Strip them the same way every other surface does.
				const text = formatDisplayUserInput(block.text);
				if (!text || isSyntheticUserText(text)) break;
				updates.push({
					sessionUpdate: "user_message_chunk",
					content: { type: "text", text },
				});
				break;
			}
			case "thinking": {
				if (!block.thinking) break;
				updates.push({
					sessionUpdate: "agent_thought_chunk",
					content: { type: "text", text: block.thinking },
				});
				break;
			}
			case "image": {
				const content = {
					type: "image" as const,
					data: block.data,
					mimeType: block.mediaType,
				};
				updates.push(
					message.role === "user"
						? { sessionUpdate: "user_message_chunk", content }
						: { sessionUpdate: "agent_message_chunk", content },
				);
				break;
			}
			case "tool_use": {
				updates.push({
					sessionUpdate: "tool_call",
					toolCallId: block.id,
					title: buildToolTitle(block.name, block.input),
					kind: mapToolKind(block.name),
					status: "pending",
					rawInput: block.input,
				});
				break;
			}
			case "tool_result": {
				updates.push({
					sessionUpdate: "tool_call_update",
					toolCallId: block.tool_use_id,
					status: block.is_error ? "failed" : "completed",
					rawOutput: flattenToolResultContent(block.content),
				});
				break;
			}
			default:
				break;
		}
	}

	return updates;
}

function flattenToolResultContent(
	content: ToolResultContent["content"],
): string {
	if (typeof content === "string") {
		return content;
	}
	return content
		.map((part) => {
			switch (part.type) {
				case "text":
					return part.text;
				case "file":
					return part.content;
				default:
					return "[image]";
			}
		})
		.join("\n");
}
