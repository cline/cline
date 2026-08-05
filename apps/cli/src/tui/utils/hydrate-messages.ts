import type { AgentMode } from "@cline/core";
import {
	formatDisplayUserInput,
	type Message,
	parseUserInputMode,
} from "@cline/shared";
import { ACT_MODE_CONTINUATION_PROMPT } from "../../runtime/interactive/mode";
import { formatToolInput } from "../../utils/helpers";
import type { ChatEntry } from "../types";

type PersistedMessage = Message & {
	metadata?: Record<string, unknown>;
};

function getDisplayRole(msg: PersistedMessage): string | undefined {
	const role = msg.metadata?.displayRole;
	return typeof role === "string" ? role.trim().toLowerCase() : undefined;
}

// The act-mode continuation prompt is runtime-generated, not typed by the
// user, so it should not surface as a user bubble in the transcript.
function isSyntheticUserText(text: string): boolean {
	return text === ACT_MODE_CONTINUATION_PROMPT;
}

function stringifyToolResult(
	content: string | Array<{ type: string; text?: string; path?: string }>,
): string {
	if (typeof content === "string") return content;
	return content
		.map((block) => {
			if (block.type === "text" && typeof block.text === "string")
				return block.text;
			if (block.type === "file" && typeof block.path === "string")
				return `Attached file: ${block.path}`;
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

export function hydrateSessionMessages(messages: Message[]): ChatEntry[] {
	const entries: ChatEntry[] = [];
	const toolUseMap = new Map<string, number>();
	// Mode each entry was produced in, recovered from <user_input mode="...">
	// wrappers and switch_to_act_mode tool calls as we walk the transcript.
	// Stays undefined for transcripts with no mode markers (pre-wrapper
	// builds, or transcripts laundered by older builds that stripped the
	// wrappers on session restarts).
	let mode: AgentMode | undefined;

	for (const msg of messages as PersistedMessage[]) {
		const displayRole = getDisplayRole(msg);
		if (displayRole === "system" || displayRole === "status") {
			continue;
		}

		if (typeof msg.content === "string") {
			if (msg.role === "user") {
				mode = parseUserInputMode(msg.content) ?? mode;
				const text = formatDisplayUserInput(msg.content);
				if (text && !isSyntheticUserText(text)) {
					entries.push({ kind: "user_submitted", text, mode });
				}
			} else {
				entries.push({
					kind: "assistant_text",
					text: msg.content,
					streaming: false,
					mode,
				});
			}
			continue;
		}

		const userTextParts: string[] = [];

		for (const block of msg.content) {
			if (block.type === "text") {
				if (msg.role === "user") {
					userTextParts.push(block.text);
				} else {
					entries.push({
						kind: "assistant_text",
						text: block.text,
						streaming: false,
						mode,
					});
				}
				continue;
			}

			if (block.type === "thinking") {
				entries.push({
					kind: "reasoning",
					text: block.thinking,
					streaming: false,
					mode,
				});
				continue;
			}

			if (block.type === "redacted_thinking") {
				continue;
			}

			if (block.type === "tool_use") {
				entries.push({
					kind: "tool_call",
					toolName: block.name,
					inputSummary: formatToolInput(block.name, block.input),
					rawInput: block.input,
					streaming: false,
					mode,
				});
				toolUseMap.set(block.id, entries.length - 1);
				// The switch tool flips the session to act mid-run; everything
				// after it was produced in act mode.
				if (block.name === "switch_to_act_mode") {
					mode = "act";
				}
				continue;
			}

			if (block.type === "tool_result") {
				const idx = toolUseMap.get(block.tool_use_id);
				if (idx != null) {
					const entry = entries[idx];
					if (entry && entry.kind === "tool_call") {
						const resultText = stringifyToolResult(
							block.content as
								| string
								| Array<{ type: string; text?: string; path?: string }>,
						);
						entry.result = {
							outputSummary: resultText.slice(0, 500),
							rawOutput: block.content,
							error: block.is_error ? resultText : undefined,
						};
					}
				}
			}
		}

		if (msg.role === "user" && userTextParts.length > 0) {
			const combined = userTextParts.join("\n");
			mode = parseUserInputMode(combined) ?? mode;
			const text = formatDisplayUserInput(combined);
			if (text && !isSyntheticUserText(text)) {
				entries.push({ kind: "user_submitted", text, mode });
			}
		}
	}

	return entries;
}
