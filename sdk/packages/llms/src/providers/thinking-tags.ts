import type { AgentModelEvent } from "@cline/shared";

export type ThinkingTagEvent = Extract<
	AgentModelEvent,
	{ type: "text-delta" } | { type: "reasoning-delta" }
>;

/**
 * Streaming parser that extracts `<think>...</think>` tags and content from model
 * text streams, routing reasoning content to `reasoning-delta` and actual text to
 * `text-delta`.
 *
 * Used by OpenAI-compatible and local providers (e.g. MiniMax M2.7, DeepSeek-R1,
 * Qwen-QwQ) that emit reasoning as inline `<think>` tags inside text completions
 * rather than dedicated reasoning stream parts.
 *
 * @see https://github.com/cline/cline/issues/9880
 */
export class ThinkingTagStreamParser {
	private mode: "text" | "reasoning" = "text";
	private buffer = "";

	/**
	 * Ingests a new text chunk and yields any parsed events.
	 */
	push(text: string): ThinkingTagEvent[] {
		this.buffer += text;
		const events: ThinkingTagEvent[] = [];

		while (this.buffer.length > 0) {
			if (this.mode === "text") {
				const ltIndex = this.buffer.indexOf("<");
				if (ltIndex === -1) {
					events.push({ type: "text-delta", text: this.buffer });
					this.buffer = "";
					break;
				}

				if (ltIndex > 0) {
					events.push({
						type: "text-delta",
						text: this.buffer.slice(0, ltIndex),
					});
					this.buffer = this.buffer.slice(ltIndex);
				}

				const match = this.buffer.match(/^<think\s*>/i);
				if (match) {
					this.buffer = this.buffer.slice(match[0].length);
					this.mode = "reasoning";
					continue;
				}

				const lowerBuf = this.buffer.toLowerCase();
				if ("<think>".startsWith(lowerBuf) || "<think ".startsWith(lowerBuf)) {
					// Incomplete prefix of an opening <think> tag, wait for more chunks
					break;
				}

				// Leading '<' was not part of a <think> tag; emit it as text
				events.push({ type: "text-delta", text: this.buffer[0] });
				this.buffer = this.buffer.slice(1);
			} else {
				const ltIndex = this.buffer.indexOf("<");
				if (ltIndex === -1) {
					events.push({ type: "reasoning-delta", text: this.buffer });
					this.buffer = "";
					break;
				}

				if (ltIndex > 0) {
					events.push({
						type: "reasoning-delta",
						text: this.buffer.slice(0, ltIndex),
					});
					this.buffer = this.buffer.slice(ltIndex);
				}

				const match = this.buffer.match(/^<\/think\s*>/i);
				if (match) {
					this.buffer = this.buffer.slice(match[0].length);
					this.mode = "text";
					continue;
				}

				const lowerBuf = this.buffer.toLowerCase();
				if (
					"</think>".startsWith(lowerBuf) ||
					"</think ".startsWith(lowerBuf)
				) {
					// Incomplete prefix of a closing </think> tag, wait for more chunks
					break;
				}

				// Leading '<' was not part of a </think> tag; emit it as reasoning
				events.push({ type: "reasoning-delta", text: this.buffer[0] });
				this.buffer = this.buffer.slice(1);
			}
		}

		return events;
	}

	/**
	 * Flushes any remaining buffered text at the end of the stream.
	 */
	flush(): ThinkingTagEvent[] {
		if (this.buffer.length === 0) return [];
		const text = this.buffer;
		this.buffer = "";
		const type = this.mode === "reasoning" ? "reasoning-delta" : "text-delta";
		return [{ type, text }];
	}
}
