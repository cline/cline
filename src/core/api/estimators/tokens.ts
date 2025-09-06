import { Anthropic } from "@anthropic-ai/sdk"

/**
 * Rough token estimator for Anthropic-style messages and a system prompt.
 * Heuristic: ~4 characters per token. Ignores images and non-text blobs.
 * Includes:
 * - systemPrompt length (if provided)
 * - text content blocks from messages
 * - string contents in tool use/results (best-effort JSON stringify if small)
 */
export function estimateTokensFromAnthropicMessages(messages: Anthropic.Messages.MessageParam[], systemPrompt?: string): number {
	let charCount = 0

	if (systemPrompt) {
		charCount += systemPrompt.length + 16 // small separator cost
	}

	for (const msg of messages || []) {
		// Anthropic content can be string or array of blocks
		if (!msg) continue
		const content: any = (msg as any).content

		if (typeof content === "string") {
			charCount += content.length + 8
			continue
		}

		if (Array.isArray(content)) {
			for (const block of content) {
				if (!block) continue
				const type = block.type

				if (type === "text" && typeof block.text === "string") {
					charCount += (block.text as string).length + 8
					continue
				}

				// Best-effort: tool use / result may include string fields that are sent
				if (type === "tool_use" || type === "tool_result") {
					// Some providers may serialize JSON-like objects; take a capped stringify to avoid huge spikes
					const fields: string[] = []
					for (const k of Object.keys(block)) {
						const v = (block as any)[k]
						// Only count short primitive strings/numbers/booleans
						if (typeof v === "string" && v.length <= 4096) {
							fields.push(v)
						} else if (typeof v === "number" || typeof v === "boolean") {
							fields.push(String(v))
						}
					}
					if (fields.length) {
						charCount += fields.join(" ").length
					}
				}

				// Ignore images, binary parts, unknown blocks
			}
		}
	}

	// Rough conversion: ~4 characters per token
	const tokens = Math.ceil(charCount / 4)
	// Add a small constant to buffer system/role/formatting overhead
	return tokens + 32
}

export default estimateTokensFromAnthropicMessages
