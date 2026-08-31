import type * as LlmsProviders from "@cline/llms";

type Block = LlmsProviders.ContentBlock;
type Message = LlmsProviders.MessageWithMetadata;

export const IMPORT_MISSING_TOOL_RESULT_TEXT =
	"[import] Tool result was not captured in the source session history.";

function isNonEmptyText(block: Block): boolean {
	return block.type !== "text" || block.text.trim().length > 0;
}

/**
 * Strips provider-session-scoped fields that only validate against the
 * original provider conversation (thinking/tool signatures, encrypted
 * reasoning) and drops empty text blocks, which some gateways reject
 * outright (all-empty-content 400s).
 */
function cleanBlocks(content: string | Block[]): string | Block[] {
	if (typeof content === "string") return content;
	const cleaned: Block[] = [];
	for (const block of content) {
		if (!isNonEmptyText(block)) continue;
		switch (block.type) {
			case "redacted_thinking":
				// Only replayable against the original provider session.
				continue;
			case "thinking": {
				if (!block.thinking?.trim()) continue;
				const { signature: _signature, ...rest } = block;
				cleaned.push(rest);
				break;
			}
			case "text": {
				const { signature: _signature, ...rest } = block;
				cleaned.push(rest);
				break;
			}
			case "tool_use": {
				const { signature: _signature, ...rest } = block;
				cleaned.push(rest);
				break;
			}
			default:
				cleaned.push(block);
		}
	}
	return cleaned;
}

function getToolUses(message: Message): Array<{ id: string; name: string }> {
	if (!Array.isArray(message.content)) return [];
	return message.content
		.filter((block) => block.type === "tool_use")
		.map((block) => ({ id: block.id, name: block.name }));
}

/**
 * Prepares foreign conversation history for persistence and eventual replay
 * to a provider:
 * - cleans blocks (see cleanBlocks) and drops messages left empty,
 * - guarantees every assistant tool_use has a matching tool_result in the
 *   user messages that follow (synthesizing placeholders for orphans),
 * - drops tool_result blocks whose tool_use no longer exists.
 *
 * Providers hard-reject histories that violate tool pairing, so this must
 * run on every imported session regardless of source quality.
 */
export function sanitizeImportedMessages(messages: Message[]): Message[] {
	const cleaned: Message[] = [];
	for (const message of messages) {
		const content = cleanBlocks(message.content);
		if (typeof content === "string") {
			if (content.trim().length === 0) continue;
			cleaned.push({ ...message, content });
			continue;
		}
		if (content.length === 0) continue;
		cleaned.push({ ...message, content });
	}

	// Pass 1: collect every tool_use id so orphaned tool_results can be culled.
	const knownToolUseIds = new Map<string, string>();
	for (const message of cleaned) {
		if (message.role !== "assistant") continue;
		for (const toolUse of getToolUses(message)) {
			knownToolUseIds.set(toolUse.id, toolUse.name);
		}
	}

	// Pass 2: drop tool_results with no matching tool_use.
	const paired: Message[] = [];
	for (const message of cleaned) {
		if (message.role !== "user" || !Array.isArray(message.content)) {
			paired.push(message);
			continue;
		}
		const kept = message.content.filter(
			(block) =>
				block.type !== "tool_result" || knownToolUseIds.has(block.tool_use_id),
		);
		if (kept.length === 0) continue;
		paired.push(
			kept.length === message.content.length
				? message
				: { ...message, content: kept },
		);
	}

	// Pass 3: every assistant tool_use must be answered by a tool_result in
	// the consecutive user messages that follow it.
	const repaired: Message[] = [];
	for (let i = 0; i < paired.length; i++) {
		const message = paired[i];
		repaired.push(message);
		if (message.role !== "assistant") continue;
		const toolUses = getToolUses(message);
		if (toolUses.length === 0) continue;

		const answered = new Set<string>();
		let scan = i + 1;
		while (scan < paired.length && paired[scan].role === "user") {
			const content = paired[scan].content;
			if (Array.isArray(content)) {
				for (const block of content) {
					if (block.type === "tool_result") answered.add(block.tool_use_id);
				}
			}
			scan++;
		}
		const missing = toolUses.filter((toolUse) => !answered.has(toolUse.id));
		if (missing.length === 0) continue;
		repaired.push({
			role: "user",
			content: missing.map((toolUse) => ({
				type: "tool_result" as const,
				tool_use_id: toolUse.id,
				name: toolUse.name,
				content: IMPORT_MISSING_TOOL_RESULT_TEXT,
			})),
		});
	}

	return repaired;
}
