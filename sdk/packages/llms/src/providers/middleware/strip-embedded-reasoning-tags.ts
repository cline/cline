/**
 * Some OpenAI-compatible backends (e.g. MiniMax M2.7) embed reasoning inside
 * plain `content` deltas using XML-like tags instead of native reasoning fields.
 * The generic openai-compatible handler forwards these as `text-delta`, so users
 * see literal `<think>` labels in assistant output.
 *
 * This parser splits embedded reasoning tags out of streamed text so callers can
 * emit proper `reasoning-delta` events (with `redacted: true` for redacted blocks).
 */

export type EmbeddedReasoningChunk =
	| { kind: "text"; text: string }
	| { kind: "reasoning"; text: string; redacted: boolean };

const REDACTED_OPEN = "<" + "redacted_thinking" + ">";
const REDACTED_CLOSE = "<" + "/redacted_thinking" + ">";
const THINK_OPEN = "\u003cthink\u003e";
const THINK_CLOSE = "\u003c/think\u003e";

const OPEN_TAGS = [
	{ open: REDACTED_OPEN, close: REDACTED_CLOSE, redacted: true },
	{ open: THINK_OPEN, close: THINK_CLOSE, redacted: false },
] as const;

const MAX_PARTIAL_PREFIX = Math.max(
	...OPEN_TAGS.flatMap((tag) => [tag.open.length, tag.close.length]),
);

type ParseMode = "text" | "reasoning";

function suffixPartialTagLength(buffer: string, tags: readonly string[]): number {
	let hold = 0;
	const maxLen = Math.min(buffer.length, MAX_PARTIAL_PREFIX);
	for (let len = 1; len <= maxLen; len++) {
		const suffix = buffer.slice(-len);
		if (tags.some((tag) => tag.startsWith(suffix))) {
			hold = len;
		}
	}
	return hold;
}

function findEarliestOpenTag(buffer: string):
	| {
			index: number;
			open: string;
			close: string;
			redacted: boolean;
	  }
	| undefined {
	let earliest:
		| {
				index: number;
				open: string;
				close: string;
				redacted: boolean;
		  }
		| undefined;

	for (const tag of OPEN_TAGS) {
		const index = buffer.indexOf(tag.open);
		if (index === -1) {
			continue;
		}
		if (!earliest || index < earliest.index) {
			earliest = {
				index,
				open: tag.open,
				close: tag.close,
				redacted: tag.redacted,
			};
		}
	}

	return earliest;
}

export class EmbeddedReasoningTagParser {
	private buffer = "";
	private mode: ParseMode = "text";
	private activeCloseTag: string | undefined;
	private activeRedacted = false;

	push(chunk: string): EmbeddedReasoningChunk[] {
		if (!chunk) {
			return [];
		}
		this.buffer += chunk;
		return this.drain();
	}

	flush(): EmbeddedReasoningChunk[] {
		if (!this.buffer) {
			return [];
		}
		const trailing = this.buffer;
		this.buffer = "";
		if (this.mode === "text") {
			return trailing ? [{ kind: "text", text: trailing }] : [];
		}
		return [
			{
				kind: "reasoning",
				text: trailing,
				redacted: this.activeRedacted,
			},
		];
	}

	private drain(): EmbeddedReasoningChunk[] {
		const out: EmbeddedReasoningChunk[] = [];

		while (this.buffer.length > 0) {
			if (this.mode === "text") {
				const openTag = findEarliestOpenTag(this.buffer);
				if (!openTag) {
					const hold = suffixPartialTagLength(
						this.buffer,
						OPEN_TAGS.map((tag) => tag.open),
					);
					const emitLength = this.buffer.length - hold;
					if (emitLength === 0) {
						break;
					}
					out.push({
						kind: "text",
						text: this.buffer.slice(0, emitLength),
					});
					this.buffer = this.buffer.slice(emitLength);
					continue;
				}

				if (openTag.index > 0) {
					out.push({
						kind: "text",
						text: this.buffer.slice(0, openTag.index),
					});
					this.buffer = this.buffer.slice(openTag.index);
				}

				if (!this.buffer.startsWith(openTag.open)) {
					break;
				}

				this.buffer = this.buffer.slice(openTag.open.length);
				this.mode = "reasoning";
				this.activeCloseTag = openTag.close;
				this.activeRedacted = openTag.redacted;
				continue;
			}

			const closeIndex = this.activeCloseTag
				? this.buffer.indexOf(this.activeCloseTag)
				: -1;
			if (closeIndex === -1) {
				const hold = suffixPartialTagLength(
					this.buffer,
					this.activeCloseTag ? [this.activeCloseTag] : [],
				);
				const emitLength = this.buffer.length - hold;
				if (emitLength === 0) {
					break;
				}
				out.push({
					kind: "reasoning",
					text: this.buffer.slice(0, emitLength),
					redacted: this.activeRedacted,
				});
				this.buffer = this.buffer.slice(emitLength);
				continue;
			}

			if (closeIndex > 0) {
				out.push({
					kind: "reasoning",
					text: this.buffer.slice(0, closeIndex),
					redacted: this.activeRedacted,
				});
				this.buffer = this.buffer.slice(closeIndex);
			}

			if (
				!this.activeCloseTag ||
				!this.buffer.startsWith(this.activeCloseTag)
			) {
				break;
			}

			this.buffer = this.buffer.slice(this.activeCloseTag.length);
			this.mode = "text";
			this.activeCloseTag = undefined;
			this.activeRedacted = false;
		}

		return out;
	}
}

export function shouldStripEmbeddedReasoningTags(
	providerId: string,
	modelId: string,
): boolean {
	if (providerId !== "openai-compatible") {
		return false;
	}
	const normalized = modelId.trim().toLowerCase();
	return normalized.includes("minimax");
}

/** @internal Exported for tests. */
export function __testing__suffixPartialTagLength(
	buffer: string,
	tags: readonly string[],
): number {
	return suffixPartialTagLength(buffer, tags);
}
