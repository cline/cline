/**
 * Streaming parser that splits a stream of `text-delta` chunks into either
 * text events or synthetic tool-call events. Used to recover tool
 * invocations from models that emit XML markup in their text instead of
 * native `tool_use` blocks — e.g. when the model is fronted by a transport
 * that does not relay structured tool-call parts (see cline/cline#9848).
 *
 * Recognized shape:
 *
 *     <invoke name="TOOL_NAME">
 *       <parameter name="KEY">VALUE</parameter>
 *       ...
 *     </invoke>
 *
 * Anything that does not match this shape is passed through as text.
 * Malformed XML (missing `name` attribute, mismatched tags, runaway partial
 * markup) is passed through as text — the parser never throws on bad
 * input, never silently swallows a closed `<invoke>` block.
 *
 * State: the parser buffers text across calls so that markup split across
 * multiple deltas is correctly reassembled. The buffer is bounded by
 * `MAX_BUFFER_BYTES` to prevent unbounded growth on runaway / malformed
 * streams.
 */

const MAX_BUFFER_BYTES = 64 * 1024;

// `<invoke ...>` opening tag. Matches `<invoke`, `<invoke>`, `< invoke >`,
// `<invoke\n name="...">`, etc.
const INVOKE_OPEN_PATTERN = /<\s*invoke\b[^>]*>/gi;
// `name="..."` attribute extractor (no /g flag — single match per tag).
const NAME_ATTR_PATTERN = /\bname\s*=\s*"([^"]*)"/i;

export type ParsedDelta =
	| { kind: "text"; text: string }
	| {
			kind: "tool-call";
			toolCallId: string;
			toolName: string;
			input: Record<string, unknown>;
	  };

export class TextDeltaToolCallParser {
	private buffer = "";
	private readonly toolCallIdFactory: () => string;

	constructor(toolCallIdFactory: () => string) {
		this.toolCallIdFactory = toolCallIdFactory;
	}

	/**
	 * Consume a text delta. Returns zero or more events to emit downstream:
	 * - `text` events for prose that did not parse as a tool call
	 * - `tool-call` events for each complete `<invoke>...</invoke>` block found
	 */
	consume(delta: string): ParsedDelta[] {
		if (!delta) {
			return [];
		}

		this.buffer += delta;

		// Bound the buffer. If exceeded, flush everything as text and reset.
		if (this.buffer.length > MAX_BUFFER_BYTES) {
			const events: ParsedDelta[] = [{ kind: "text", text: this.buffer }];
			this.buffer = "";
			return events;
		}

		const events: ParsedDelta[] = [];

		while (true) {
			const openMatch = matchFirst(this.buffer, INVOKE_OPEN_PATTERN);
			if (!openMatch) {
				break;
			}

			// Look for a matching closing tag *after* the opening tag,
			// skipping any `</invoke>` that appears inside an unclosed
			// `<parameter>...</parameter>` body (e.g. a parameter value
			// whose contents describe this format).
			const closeMatch = findCloseTag(this.buffer, openMatch.end);

			if (!closeMatch) {
				// Incomplete: closing tag not yet seen. Emit the prefix
				// (text before the partial opening tag) and keep only the
				// partial opening tag and what follows in the buffer.
				if (openMatch.start > 0) {
					events.push({
						kind: "text",
						text: this.buffer.slice(0, openMatch.start),
					});
					this.buffer = this.buffer.slice(openMatch.start);
				}
				return events;
			}

			// Extract the `name="..."` attribute from the opening tag.
			const openTag = this.buffer.slice(openMatch.start, openMatch.end);
			const nameMatch = NAME_ATTR_PATTERN.exec(openTag);
			if (!nameMatch || !nameMatch[1]) {
				// Malformed: opening tag has no `name` attribute. Emit the
				// opening tag as text and continue scanning the rest of
				// the buffer.
				events.push({ kind: "text", text: openTag });
				this.buffer = this.buffer.slice(openMatch.end);
				continue;
			}

			const toolName = nameMatch[1];
			const innerContent = this.buffer.slice(openMatch.end, closeMatch.start);
			const input = parseParameters(innerContent);

			if (openMatch.start > 0) {
				events.push({
					kind: "text",
					text: this.buffer.slice(0, openMatch.start),
				});
			}

			events.push({
				kind: "tool-call",
				toolCallId: this.toolCallIdFactory(),
				toolName,
				input,
			});

			this.buffer = this.buffer.slice(closeMatch.end);
		}

		// No more complete tool calls in the buffer. Emit any buffer
		// content that is unambiguously prose as text, but keep a tail
		// that might still be the start of an XML block.
		if (this.buffer.length > 0) {
			const safe = this.findSafeEmitBoundary(this.buffer);
			if (safe > 0) {
				events.push({ kind: "text", text: this.buffer.slice(0, safe) });
				this.buffer = this.buffer.slice(safe);
			}
		}

		return events;
	}

	/**
	 * Flush any remaining buffer as text. Called when the model stream ends
	 * (or is aborted). After this call the parser is reset.
	 */
	flush(): ParsedDelta[] {
		if (this.buffer.length === 0) {
			return [];
		}
		const events: ParsedDelta[] = [{ kind: "text", text: this.buffer }];
		this.buffer = "";
		return events;
	}

	/**
	 * Find the largest prefix of `text` that cannot be the start of an
	 * `<invoke>` block, even with more bytes appended. We keep any suffix
	 * starting from the last '<' in the buffer, because we cannot yet tell
	 * whether it's a tool-call opener or just an angle bracket in prose.
	 */
	private findSafeEmitBoundary(text: string): number {
		const lastLt = text.lastIndexOf("<");
		return lastLt === -1 ? text.length : lastLt;
	}
}

function matchFirst(
	text: string,
	regex: RegExp,
): { start: number; end: number } | null {
	regex.lastIndex = 0;
	const m = regex.exec(text);
	if (!m) {
		return null;
	}
	return { start: m.index, end: m.index + m[0].length };
}

/**
 * Parse `<parameter ...>...</parameter>` (or self-closing) blocks out of the
 * content between `<invoke>` and `</invoke>`. Walks forward to classify
 * every `<parameter>` open, self-close, and `</parameter>` close, then
 * processes opens LEFT to RIGHT, binding each open to the LAST `</parameter>`
 * that lies within its scope (i.e. between this open's end and the next
 * open's start, or end of buffer). Any `</parameter>` that sits between an
 * open and its binding close is absorbed as content rather than treated
 * as the open's closer.
 *
 * This is what lets a parameter value contain the literal `</parameter>`
 * without truncating: the stray close inside the value lands between the
 * open and the LAST close in scope, so it ends up inside the slice that
 * becomes the value. Tolerant of malformed input: an open whose close
 * never arrives keeps the remainder as its value rather than throwing.
 */
function parseParameters(content: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const closeParam = /^<\s*\/\s*parameter\s*>/i;
	const selfCloseParam = /^<\s*parameter\b[^>]*\/\s*>/i;
	const openParam = /^<\s*parameter\b[^>]*>/i;

	type Open = { start: number; end: number; key: string | null };
	const opens: Open[] = [];
	const selfs: Open[] = [];
	const closes: { start: number; end: number }[] = [];

	let i = 0;
	while (i < content.length) {
		const lt = content.indexOf("<", i);
		if (lt === -1) {
			break;
		}
		const slice = content.slice(lt);
		let m: RegExpExecArray | null;
		if ((m = selfCloseParam.exec(slice))) {
			const nameMatch = NAME_ATTR_PATTERN.exec(slice);
			selfs.push({
				start: lt,
				end: lt + m[0].length,
				key: nameMatch?.[1] ?? null,
			});
			i = lt + m[0].length;
		} else if ((m = openParam.exec(slice))) {
			const nameMatch = NAME_ATTR_PATTERN.exec(slice);
			opens.push({
				start: lt,
				end: lt + m[0].length,
				key: nameMatch?.[1] ?? null,
			});
			i = lt + m[0].length;
		} else if ((m = closeParam.exec(slice))) {
			closes.push({ start: lt, end: lt + m[0].length });
			i = lt + m[0].length;
		} else {
			// Anything else (prose '<' or other tag) — step over.
			i = lt + 1;
		}
	}

	// Self-closing tags resolve immediately — empty value, no pairing needed.
	for (const s of selfs) {
		if (s.key !== null) {
			result[s.key] = "";
		}
	}

	// Process opens LEFT to RIGHT. For each open, find the LAST close that
	// lies within its scope (after this open's end and before the next
	// open's start, or end of buffer). That close binds the open; any
	// other closes between the open's end and the binding close are
	// absorbed into the value as content. If no close is in scope, the
	// open keeps the remainder as its value (tolerant of malformed input).
	for (let oi = 0; oi < opens.length; oi++) {
		const open = opens[oi];
		if (open.key === null) {
			continue;
		}
		const nextStart =
			oi + 1 < opens.length ? opens[oi + 1].start : content.length;
		let binding: { start: number; end: number } | null = null;
		for (const close of closes) {
			if (close.start >= open.end && close.end <= nextStart) {
				binding = close;
			}
		}
		if (binding) {
			result[open.key] = content.slice(open.end, binding.start).trim();
		} else {
			result[open.key] = content.slice(open.end, nextStart).trim();
		}
	}

	return result;
}

/**
 * Forward scan from `openEnd` in `buffer` for the real `</invoke>` closer
 * of the current `<invoke>` block. Tracks `<parameter>` depth so that
 * `</invoke>` candidates appearing inside an unclosed parameter body are
 * skipped (they are content, not the block closer). Linear in body length,
 * bounded by buffer size.
 *
 * Returns `{ start, end }` of the matching `</invoke>` tag, or `null` if
 * the scan runs off the end without finding one (caller should keep the
 * tail buffered for more input).
 */
function findCloseTag(
	buffer: string,
	openEnd: number,
): { start: number; end: number } | null {
	const closeInvoke = /^<\s*\/\s*invoke\s*>/i;
	const closeParam = /^<\s*\/\s*parameter\s*>/i;
	const selfCloseParam = /^<\s*parameter\b[^>]*\/\s*>/i;
	const openParam = /^<\s*parameter\b[^>]*>/i;

	let paramDepth = 0;
	let i = openEnd;
	while (i < buffer.length) {
		const lt = buffer.indexOf("<", i);
		if (lt === -1) {
			return null;
		}
		const slice = buffer.slice(lt);
		let m: RegExpExecArray | null;
		if ((m = closeInvoke.exec(slice))) {
			if (paramDepth === 0) {
				return { start: lt, end: lt + m[0].length };
			}
			i = lt + m[0].length;
		} else if ((m = closeParam.exec(slice))) {
			if (paramDepth > 0) {
				paramDepth--;
			}
			i = lt + m[0].length;
		} else if ((m = selfCloseParam.exec(slice))) {
			i = lt + m[0].length;
		} else if ((m = openParam.exec(slice))) {
			paramDepth++;
			i = lt + m[0].length;
		} else {
			// Anything else (prose '<' or other tag) — step over and keep
			// scanning. Depth is unchanged for non-parameter tags, so a
			// stray '<' inside a parameter body does not corrupt depth
			// tracking.
			i = lt + 1;
		}
	}
	return null;
}
