/**
 * Translate Kimi / Moonshot plain-text tool markers into structured tool calls.
 *
 * Models such as Kimi K2.x (including via Together) often emit tool requests as
 * content markers instead of OpenAI-style `delta.tool_calls`:
 *
 * ```
 * <|tool_calls_section_begin|>
 * <|tool_call_begin|>functions.read_file:0
 * <|tool_call_argument_begin|>{"path":"foo.ts"}
 * <|tool_call_end|>
 * <|tool_calls_section_end|>
 * ```
 *
 * Without a translator those markers leak into chat text and never execute.
 * This module streams text through a small state machine that strips markers
 * and yields complete tool calls (same shape Cline already executes).
 *
 * Format reference: Moonshot tool_call_guidance + vLLM kimi_k2_tool_parser.
 */

export const KIMI_TOOL_SECTION_BEGIN = "<|tool_calls_section_begin|>";
export const KIMI_TOOL_SECTION_END = "<|tool_calls_section_end|>";
export const KIMI_TOOL_CALL_BEGIN = "<|tool_call_begin|>";
export const KIMI_TOOL_CALL_END = "<|tool_call_end|>";
export const KIMI_TOOL_CALL_ARGUMENT_BEGIN = "<|tool_call_argument_begin|>";

const ALL_MARKERS = [
	KIMI_TOOL_SECTION_BEGIN,
	KIMI_TOOL_SECTION_END,
	KIMI_TOOL_CALL_BEGIN,
	KIMI_TOOL_CALL_END,
	KIMI_TOOL_CALL_ARGUMENT_BEGIN,
] as const;

/** True when text contains (or may be starting) a Kimi tool marker. */
export function looksLikeKimiToolMarkup(text: string): boolean {
	if (text.includes("<|tool_")) {
		return true;
	}
	// Hold partial prefixes of `<|…` so streaming chunks do not leak mid-token.
	return longestPartialMarkerSuffix(text) > 0;
}

/**
 * How many trailing characters of `text` are a proper prefix of a known marker
 * (but not a full marker). Used so we do not emit a partial `<|tool_…` into chat.
 */
export function longestPartialMarkerSuffix(text: string): number {
	let hold = 0;
	const maxLen = Math.min(
		text.length,
		Math.max(...ALL_MARKERS.map((m) => m.length)) - 1,
	);
	for (let n = 1; n <= maxLen; n++) {
		const suffix = text.slice(-n);
		if (ALL_MARKERS.some((m) => m.startsWith(suffix) && m !== suffix)) {
			hold = n;
		}
	}
	return hold;
}

export type KimiMarkerEvent =
	| { type: "text"; text: string }
	| {
			type: "tool-call";
			toolCallId: string;
			toolName: string;
			inputText: string;
			input?: unknown;
	  };

/**
 * Extract the function name from a Kimi tool id such as `functions.read_file:0`.
 * Falls back to the raw id when the shape is unexpected.
 */
export function toolNameFromKimiToolId(toolCallId: string): string {
	const trimmed = toolCallId.trim();
	const match = /^functions\.(.+):(\d+)$/.exec(trimmed);
	if (match) {
		return match[1];
	}
	// Tolerate missing `functions.` prefix: `read_file:0`
	const loose = /^(.+):(\d+)$/.exec(trimmed);
	if (loose) {
		return loose[1];
	}
	return trimmed || "tool";
}

function tryParseJson(text: string): unknown | undefined {
	const trimmed = text.trim();
	if (!trimmed) {
		return {};
	}
	try {
		return JSON.parse(trimmed) as unknown;
	} catch {
		return undefined;
	}
}

/**
 * Parse one tool-call body (text between begin/end markers):
 * `functions.name:0<|tool_call_argument_begin|>{...}`
 */
export function parseKimiToolCallBody(
	body: string,
): Omit<Extract<KimiMarkerEvent, { type: "tool-call" }>, "type"> | undefined {
	const sep = body.indexOf(KIMI_TOOL_CALL_ARGUMENT_BEGIN);
	if (sep === -1) {
		return undefined;
	}
	const toolCallId = body.slice(0, sep).trim();
	const inputText = body.slice(sep + KIMI_TOOL_CALL_ARGUMENT_BEGIN.length).trim();
	if (!toolCallId) {
		return undefined;
	}
	const input = tryParseJson(inputText);
	return {
		toolCallId,
		toolName: toolNameFromKimiToolId(toolCallId),
		inputText,
		...(input !== undefined ? { input } : {}),
	};
}

/**
 * Streaming translator: feed text deltas, get safe text + structured tool calls.
 * Call {@link KimiToolMarkerTranslator.flush} when the model stream ends.
 */
export class KimiToolMarkerTranslator {
	private buffer = "";
	/** True while inside a section begin…end, or after a bare call begin. */
	private inToolRegion = false;

	*push(text: string): Generator<KimiMarkerEvent> {
		if (!text) {
			return;
		}
		this.buffer += text;
		yield* this.drain(false);
	}

	*flush(): Generator<KimiMarkerEvent> {
		yield* this.drain(true);
	}

	private *drain(final: boolean): Generator<KimiMarkerEvent> {
		while (true) {
			if (!this.inToolRegion) {
				const sectionBegin = this.buffer.indexOf(KIMI_TOOL_SECTION_BEGIN);
				const callBegin = this.buffer.indexOf(KIMI_TOOL_CALL_BEGIN);

				let enterAt = -1;
				let enterLen = 0;
				if (sectionBegin !== -1 && (callBegin === -1 || sectionBegin <= callBegin)) {
					enterAt = sectionBegin;
					enterLen = KIMI_TOOL_SECTION_BEGIN.length;
				} else if (callBegin !== -1) {
					enterAt = callBegin;
					enterLen = 0; // keep call begin in buffer for parse loop
				}

				if (enterAt === -1) {
					const hold = final ? 0 : longestPartialMarkerSuffix(this.buffer);
					const emitLen = this.buffer.length - hold;
					if (emitLen > 0) {
						yield { type: "text", text: this.buffer.slice(0, emitLen) };
						this.buffer = this.buffer.slice(emitLen);
					} else if (final && this.buffer.length > 0) {
						// Incomplete marker at EOS — drop it so it never reaches chat.
						this.buffer = "";
					}
					return;
				}

				if (enterAt > 0) {
					yield { type: "text", text: this.buffer.slice(0, enterAt) };
				}
				this.buffer = this.buffer.slice(enterAt + enterLen);
				this.inToolRegion = true;
				continue;
			}

			// Inside tool region: emit complete calls; exit on section end.
			const sectionEnd = this.buffer.indexOf(KIMI_TOOL_SECTION_END);
			const callBegin = this.buffer.indexOf(KIMI_TOOL_CALL_BEGIN);

			if (callBegin === -1) {
				if (sectionEnd !== -1) {
					this.buffer = this.buffer.slice(
						sectionEnd + KIMI_TOOL_SECTION_END.length,
					);
					this.inToolRegion = false;
					continue;
				}
				if (final) {
					// Incomplete region — discard residual marker junk.
					this.buffer = "";
					this.inToolRegion = false;
				}
				return;
			}

			// If section end comes before the next call, close the region first
			// (shouldn't normally happen mid-call, but keeps state sane).
			if (sectionEnd !== -1 && sectionEnd < callBegin) {
				this.buffer = this.buffer.slice(
					sectionEnd + KIMI_TOOL_SECTION_END.length,
				);
				this.inToolRegion = false;
				continue;
			}

			const afterBegin = callBegin + KIMI_TOOL_CALL_BEGIN.length;
			const callEnd = this.buffer.indexOf(KIMI_TOOL_CALL_END, afterBegin);
			if (callEnd === -1) {
				if (final) {
					this.buffer = "";
					this.inToolRegion = false;
				}
				return;
			}

			const body = this.buffer.slice(afterBegin, callEnd);
			const parsed = parseKimiToolCallBody(body);
			if (parsed) {
				yield { type: "tool-call", ...parsed };
			}
			this.buffer = this.buffer.slice(callEnd + KIMI_TOOL_CALL_END.length);
		}
	}
}
