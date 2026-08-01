// Splitting a streaming markdown document into a stable prefix and an active
// tail bounds per-delta rendering work. Re-rendering the entire document on
// every streamed token makes OpenTUI's markdown pipeline (tree-sitter
// highlighting + native text buffers) redo O(document) work per token, which
// permanently grows native memory in long sessions. The stable prefix only
// changes when a new block completes, so the per-token cost is O(active tail).

const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Split streaming markdown at the last block boundary (a blank line outside
 * any code fence). Everything before the boundary is `stable` (safe to parse
 * once and cache); the remainder is the actively-streaming `tail`.
 *
 * The blank-line separator is kept at the end of `stable` so `stable + tail`
 * always reconstructs the original text.
 */
export function splitStreamingMarkdown(text: string): {
	stable: string;
	tail: string;
} {
	let fence: "`" | "~" | null = null;
	let lastSafeOffset = 0;
	let offset = 0;
	let lineStart = 0;

	while (lineStart <= text.length) {
		const newlineIndex = text.indexOf("\n", lineStart);
		const isLastLine = newlineIndex === -1;
		const lineEnd = isLastLine ? text.length : newlineIndex;
		const line = text.slice(lineStart, lineEnd);

		const fenceMatch = FENCE_PATTERN.exec(line);
		if (fenceMatch?.[1]) {
			const marker = fenceMatch[1].startsWith("`") ? "`" : "~";
			if (fence === null) {
				fence = marker;
			} else if (fence === marker) {
				fence = null;
			}
		}

		offset = isLastLine ? text.length : lineEnd + 1;

		// A blank line outside a fence marks the end of a block. The text
		// after it is still streaming, so the boundary sits after the blank
		// line. The final line never qualifies: with no newline yet, the
		// block may still grow.
		if (!isLastLine && fence === null && line.trim() === "") {
			lastSafeOffset = offset;
		}

		if (isLastLine) {
			break;
		}
		lineStart = newlineIndex + 1;
	}

	return {
		stable: text.slice(0, lastSafeOffset),
		tail: text.slice(lastSafeOffset),
	};
}
