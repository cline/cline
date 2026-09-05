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

	// Pass 3: every assistant tool_use must be answered by a tool_result, and
	// providers (Anthropic strictly) want all of a turn's results in the user
	// message immediately following it. Whenever the span of user messages
	// after an assistant turn is incomplete or split across messages, rebuild
	// it as one consolidated results message (tool_use order, placeholders
	// for anything missing) followed by a message with whatever else was
	// there, mirroring the legacy migration sanitizer.
	const repaired: Message[] = [];
	for (let i = 0; i < paired.length; i++) {
		const message = paired[i];
		repaired.push(message);
		if (message.role !== "assistant") continue;
		const toolUses = getToolUses(message);
		if (toolUses.length === 0) continue;

		const toolUseIds = new Set(toolUses.map((toolUse) => toolUse.id));
		const results = new Map<string, Block>();
		const otherBlocks: Block[] = [];
		let spanEnd = i + 1;
		while (spanEnd < paired.length && paired[spanEnd].role === "user") {
			const content = paired[spanEnd].content;
			const blocks: Block[] =
				typeof content === "string"
					? [{ type: "text", text: content }]
					: content;
			for (const block of blocks) {
				if (
					block.type === "tool_result" &&
					toolUseIds.has(block.tool_use_id) &&
					!results.has(block.tool_use_id)
				) {
					results.set(block.tool_use_id, block);
				} else if (
					block.type !== "tool_result" ||
					!toolUseIds.has(block.tool_use_id)
				) {
					otherBlocks.push(block);
				}
				// Duplicate results for an already-answered id are dropped.
			}
			spanEnd++;
		}
		const span = paired.slice(i + 1, spanEnd);
		const missing = toolUses.filter((toolUse) => !results.has(toolUse.id));
		const alreadyConsolidated =
			missing.length === 0 && span.length === 1 && otherBlocks.length === 0;
		if (alreadyConsolidated) continue;

		repaired.push({
			...(span[0] ?? {}),
			role: "user",
			content: toolUses.map(
				(toolUse) =>
					results.get(toolUse.id) ?? {
						type: "tool_result" as const,
						tool_use_id: toolUse.id,
						name: toolUse.name,
						content: IMPORT_MISSING_TOOL_RESULT_TEXT,
					},
			),
		});
		if (otherBlocks.length > 0) {
			repaired.push({ role: "user", content: otherBlocks });
		}
		i = spanEnd - 1;
	}

	return repaired;
}
