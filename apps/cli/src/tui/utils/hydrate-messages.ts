import { type AgentMode, projectSessionMessagesForDisplay } from "@cline/core";
import {
	formatDisplayUserInput,
	type GeneratedMedia,
	type MessageWithMetadata,
	parseUserInputMode,
} from "@cline/shared";
import { ACT_MODE_CONTINUATION_PROMPT } from "../../runtime/interactive/mode";
import { materializeGeneratedMedia } from "../../utils/generated-media";
import { formatToolInput } from "../../utils/helpers";
import type { ChatEntry } from "../types";

function getDisplayRole(msg: MessageWithMetadata): string | undefined {
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
			if (block.type === "image") return "[image]";
			try {
				return JSON.stringify(block);
			} catch {
				return String(block);
			}
		})
		.filter(Boolean)
		.join("\n");
}

function stringifyToolError(content: unknown): string {
	if (typeof content === "string") return content;
	try {
		return JSON.stringify(content) ?? String(content);
	} catch {
		return String(content);
	}
}

export function hydrateSessionMessages(
	messages: MessageWithMetadata[],
): ChatEntry[] {
	const entries: ChatEntry[] = [];
	const toolUseMap = new Map<string, number>();
	// Mode each entry was produced in, recovered from <user_input mode="...">
	// wrappers and switch_to_act_mode tool calls as we walk the transcript.
	// Stays undefined for transcripts with no mode markers (pre-wrapper
	// builds, or transcripts laundered by older builds that stripped the
	// wrappers on session restarts).
	let mode: AgentMode | undefined;

	for (const { message: msg } of projectSessionMessagesForDisplay(messages)) {
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
			if (
				msg.role === "assistant" &&
				(block.type === "image" || block.type === "media")
			) {
				const media: GeneratedMedia =
					block.type === "media"
						? block.media
						: {
								id: `${msg.id ?? "history"}:media:${entries.length}`,
								modality: "image",
								mediaType: block.mediaType,
								source: { type: "base64", data: block.data },
							};
				if (media.source.type !== "base64" || media.source.data.length > 0) {
					const saved = materializeGeneratedMedia(media);
					entries.push({
						kind: "assistant_media",
						modality: media.modality,
						mediaType: media.mediaType,
						byteLength: saved?.byteLength ?? media.sizeBytes ?? 0,
						location:
							saved?.path ??
							(media.source.type === "url"
								? media.source.url
								: media.source.type === "artifact"
									? `artifact:${media.source.artifactId}`
									: undefined),
						mode,
					});
				}
				continue;
			}

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
					toolCallId: block.id,
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
						const error = block.is_error
							? stringifyToolError(block.content)
							: undefined;
						entry.result = error
							? { outputSummary: "", rawOutput: undefined, error }
							: {
									outputSummary: resultText.slice(0, 500),
									rawOutput: block.content,
									error: undefined,
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
