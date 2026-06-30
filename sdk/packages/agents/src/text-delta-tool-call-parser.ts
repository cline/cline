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
// `</invoke>` closing tag.
const INVOKE_CLOSE_PATTERN = /<\s*\/\s*invoke\s*>/gi;
// `name="..."` attribute extractor (no /g flag — single match per tag).
const NAME_ATTR_PATTERN = /\bname\s*=\s*"([^"]*)"/i;
// `<parameter name="K">V</parameter>` (or self-closing). Global so we can
// iterate parameters inside a single `<invoke>` body.
const PARAMETER_PATTERN =
	/<\s*parameter\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\s*\/\s*parameter\s*>)/gi;

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

			// Look for a matching closing tag *after* the opening tag.
			const closeRegex = new RegExp(INVOKE_CLOSE_PATTERN.source, "gi");
			closeRegex.lastIndex = openMatch.end;
			const closeMatch = closeRegex.exec(this.buffer);

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
			const innerContent = this.buffer.slice(openMatch.end, closeMatch.index);
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

			this.buffer = this.buffer.slice(closeMatch.index + closeMatch[0].length);
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

function parseParameters(content: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	PARAMETER_PATTERN.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = PARAMETER_PATTERN.exec(content)) !== null) {
		const attrs = m[1];
		const innerText = (m[2] ?? "").trim();
		const nameMatch = NAME_ATTR_PATTERN.exec(attrs);
		if (!nameMatch || !nameMatch[1]) {
			continue;
		}
		result[nameMatch[1]] = innerText;
	}
	return result;
}
