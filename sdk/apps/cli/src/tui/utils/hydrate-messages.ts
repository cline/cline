import type { Llms } from "@clinebot/core";
import { formatDisplayUserInput } from "@clinebot/shared";
import { formatToolInput } from "../../utils/helpers";
import type { ChatEntry } from "../types";

type PersistedMessage = Llms.Message & {
	metadata?: Record<string, unknown>;
};

function getDisplayRole(msg: PersistedMessage): string | undefined {
	const role = msg.metadata?.displayRole;
	return typeof role === "string" ? role.trim().toLowerCase() : undefined;
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

export function hydrateSessionMessages(messages: Llms.Message[]): ChatEntry[] {
	const entries: ChatEntry[] = [];
	const toolUseMap = new Map<string, number>();

	for (const msg of messages as PersistedMessage[]) {
		const displayRole = getDisplayRole(msg);
		if (displayRole === "system" || displayRole === "status") {
			continue;
		}

		if (typeof msg.content === "string") {
			if (msg.role === "user") {
				const text = formatDisplayUserInput(msg.content);
				if (text) entries.push({ kind: "user_submitted", text });
			} else {
				entries.push({
					kind: "assistant_text",
					text: msg.content,
					streaming: false,
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
					});
				}
				continue;
			}

			if (block.type === "thinking") {
				entries.push({
					kind: "reasoning",
					text: block.thinking,
					streaming: false,
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
				});
				toolUseMap.set(block.id, entries.length - 1);
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
			const text = formatDisplayUserInput(combined);
			if (text) {
				entries.push({ kind: "user_submitted", text });
			}
		}
	}

	return entries;
}
