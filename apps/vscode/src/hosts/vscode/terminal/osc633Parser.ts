/**
 * Stateful, chunk-boundary-safe parser for VS Code's OSC 633 shell integration
 * sequences.
 *
 * `TerminalShellExecution.read()` yields *raw* terminal data — including escape
 * sequences — so a command's output is delimited by the OSC 633 control codes
 * that VS Code's shell integration script emits. Those markers can be split
 * arbitrarily across chunks (e.g. a chunk ending in `…\x1b]633;` and the next
 * starting with `C\x07`, or even split at the `ESC \` ST terminator). A simple
 * per-chunk regex therefore misses markers that straddle a boundary, which is
 * the root cause of empty/garbled output for commands that stream slowly.
 *
 * This parser keeps the cross-chunk state needed to extract those events
 * reliably. It is a focused port of VS Code's own `Osc633Parser`
 * (src/vs/platform/agentHost/node/osc633Parser.ts), which is exercised by an
 * extensive boundary-splitting test suite upstream.
 *
 * Reference: https://code.visualstudio.com/docs/terminal/shell-integration#_vs-code-custom-sequences-osc-633-st
 */

/** OSC 633 event types we care about. */
export const enum Osc633EventType {
	/** 633;A — Prompt start. Indicates shell integration is active. */
	PromptStart = 0,
	/** 633;B — Command start (where the user inputs their command). */
	CommandStart = 1,
	/** 633;C — Command executed; the command's output begins after this. */
	CommandExecuted = 2,
	/** 633;D[;<exitCode>] — Command finished. */
	CommandFinished = 3,
	/** 633;E;<commandLine>[;<nonce>] — Explicit command line. */
	CommandLine = 4,
	/** 633;P;<Key>=<Value> — Property (e.g. Cwd). */
	Property = 5,
}

export interface Osc633PromptStartEvent {
	type: Osc633EventType.PromptStart
}
export interface Osc633CommandStartEvent {
	type: Osc633EventType.CommandStart
}
export interface Osc633CommandExecutedEvent {
	type: Osc633EventType.CommandExecuted
}
export interface Osc633CommandFinishedEvent {
	type: Osc633EventType.CommandFinished
	exitCode: number | undefined
}
export interface Osc633CommandLineEvent {
	type: Osc633EventType.CommandLine
	commandLine: string
	nonce: string | undefined
}
export interface Osc633PropertyEvent {
	type: Osc633EventType.Property
	key: string
	value: string
}

export type Osc633Event =
	| Osc633PromptStartEvent
	| Osc633CommandStartEvent
	| Osc633CommandExecutedEvent
	| Osc633CommandFinishedEvent
	| Osc633CommandLineEvent
	| Osc633PropertyEvent

/**
 * An ordered piece of a parsed chunk: either a run of cleaned text or an OSC 633
 * event. Segments preserve the original interleaving so consumers can gate text
 * on the surrounding markers (e.g. keep only text between `C` and `D`).
 */
export type Osc633Segment = { kind: "text"; text: string } | { kind: "event"; event: Osc633Event }

export interface Osc633ParseResult {
	/** Input data with all OSC 633 sequences removed (non-633 OSC kept intact). */
	cleanedData: string
	/** Events extracted from OSC 633 sequences in this chunk. */
	events: Osc633Event[]
	/** Text runs and events in the order they appeared in the chunk. */
	segments: Osc633Segment[]
}

// OSC introducer is ESC ] (0x1b 0x5d)
const ESC = "\x1b"
const OSC_START = ESC + "]"
// Terminators: BEL (0x07) or ST (ESC \)
const BEL = "\x07"
const ST = ESC + "\\"

/**
 * Decode escaped values in OSC 633 messages.
 * Handles `\\` -> `\` and `\xAB` -> character with code 0xAB.
 */
function deserializeOscMessage(message: string): string {
	if (message.indexOf("\\") === -1) {
		return message
	}
	return message.replaceAll(/\\(\\|x([0-9a-f]{2}))/gi, (_match: string, op: string, hex?: string) =>
		hex ? String.fromCharCode(Number.parseInt(hex, 16)) : op,
	)
}

/**
 * Parse the payload of an OSC 633 sequence (the part after `633;`) into an event.
 * Returns undefined for unknown/malformed sequences.
 */
function parseOsc633Payload(payload: string): Osc633Event | undefined {
	const command = payload[0]
	// The command identifier must be a single char followed by either end-of-string or ';'.
	const semiIdx = payload.indexOf(";")
	if ((semiIdx === -1 ? payload.length : semiIdx) !== 1) {
		return undefined
	}
	const argsRaw = semiIdx === -1 ? "" : payload.substring(semiIdx + 1)

	switch (command) {
		case "A":
			return { type: Osc633EventType.PromptStart }
		case "B":
			return { type: Osc633EventType.CommandStart }
		case "C":
			return { type: Osc633EventType.CommandExecuted }
		case "D": {
			const exitCode = argsRaw.length > 0 ? Number.parseInt(argsRaw, 10) : undefined
			return {
				type: Osc633EventType.CommandFinished,
				exitCode: exitCode !== undefined && !Number.isNaN(exitCode) ? exitCode : undefined,
			}
		}
		case "E": {
			const nonceIdx = argsRaw.indexOf(";")
			const commandLine = deserializeOscMessage(nonceIdx === -1 ? argsRaw : argsRaw.substring(0, nonceIdx))
			const nonce = nonceIdx === -1 ? undefined : argsRaw.substring(nonceIdx + 1)
			return { type: Osc633EventType.CommandLine, commandLine, nonce }
		}
		case "P": {
			const deserialized = deserializeOscMessage(argsRaw)
			const eqIdx = deserialized.indexOf("=")
			if (eqIdx === -1) {
				return undefined
			}
			return {
				type: Osc633EventType.Property,
				key: deserialized.substring(0, eqIdx),
				value: deserialized.substring(eqIdx + 1),
			}
		}
		default:
			return undefined
	}
}

/**
 * Stateful OSC 633 stream parser. Feed it each chunk from
 * `TerminalShellExecution.read()` via {@link parse}; it returns the data with
 * 633 sequences stripped plus any events found, correctly handling sequences
 * that span multiple chunks.
 */
export class Osc633Parser {
	/** Buffer for an incomplete OSC sequence (after ESC ] up to but not including the terminator). */
	private _pendingOsc = ""
	/** Whether we are currently accumulating an OSC sequence. */
	private _inOsc = false
	/** Set when the previous chunk ended with ESC inside an OSC body (potential ST start). */
	private _pendingEscInOsc = false

	parse(data: string): Osc633ParseResult {
		const events: Osc633Event[] = []
		const segments: Osc633Segment[] = []
		// Fast path: nothing in flight and no OSC introducer in this chunk.
		if (!this._inOsc && data.indexOf(OSC_START) === -1) {
			if (data.length > 0) {
				segments.push({ kind: "text", text: data })
			}
			return { cleanedData: data, events, segments }
		}

		// Running buffer of cleaned text; flushed into a text segment before each event.
		let pendingText = ""
		const appendText = (text: string) => {
			pendingText += text
		}
		const flushText = () => {
			if (pendingText.length > 0) {
				segments.push({ kind: "text", text: pendingText })
				pendingText = ""
			}
		}
		const handle = (payload: string, terminator?: string) => {
			const passthrough = this._handleOscPayload(payload, events, segments, flushText, terminator)
			if (passthrough !== undefined) {
				appendText(passthrough)
			}
		}

		let i = 0
		while (i < data.length) {
			if (this._inOsc) {
				// Handle an ESC that was left pending from the previous chunk.
				if (this._pendingEscInOsc) {
					this._pendingEscInOsc = false
					if (data[i] === "\\") {
						// ESC \ = ST terminator, sequence is complete.
						i++
						this._inOsc = false
						const payload = this._pendingOsc
						this._pendingOsc = ""
						handle(payload, ST)
						continue
					}
					// ESC not followed by \: malformed, complete the OSC anyway.
					this._inOsc = false
					const payload = this._pendingOsc
					this._pendingOsc = ""
					handle(payload)
					continue
				}

				// We're inside an OSC sequence; look for its terminator.
				const result = this._consumeOscBody(data, i)
				i = result.nextIndex
				if (result.complete) {
					this._inOsc = false
					const payload = this._pendingOsc
					this._pendingOsc = ""
					handle(payload, result.terminator)
				} else if (result.pendingEsc) {
					this._pendingEscInOsc = true
				}
				// If not complete, _pendingOsc has been extended and we're at end of data.
				continue
			}

			// Look for the next ESC ] which starts an OSC sequence.
			const escIdx = data.indexOf(OSC_START, i)
			if (escIdx === -1) {
				appendText(data.substring(i))
				i = data.length
				continue
			}

			// Copy everything before the OSC start to cleaned output.
			appendText(data.substring(i, escIdx))

			// Enter OSC body parsing.
			i = escIdx + 2 // skip past ESC ]
			this._pendingOsc = ""
			this._inOsc = true

			const result = this._consumeOscBody(data, i)
			i = result.nextIndex
			if (result.complete) {
				this._inOsc = false
				const payload = this._pendingOsc
				this._pendingOsc = ""
				handle(payload, result.terminator)
			} else if (result.pendingEsc) {
				this._pendingEscInOsc = true
			}
			// If not complete, we're at end of data and _pendingOsc is buffered.
		}

		flushText()
		const cleanedData = segments.reduce((acc, seg) => (seg.kind === "text" ? acc + seg.text : acc), "")
		return { cleanedData, events, segments }
	}

	/**
	 * Consume characters from the OSC body starting at `startIdx`, appending to
	 * `_pendingOsc` until a terminator (BEL or ST) is found.
	 */
	private _consumeOscBody(
		data: string,
		startIdx: number,
	): { nextIndex: number; complete: boolean; pendingEsc?: boolean; terminator?: string } {
		const belIdx = data.indexOf(BEL, startIdx)
		const escIdx = data.indexOf(ESC, startIdx)

		if (belIdx !== -1 && (escIdx === -1 || belIdx < escIdx)) {
			this._pendingOsc += data.substring(startIdx, belIdx)
			return { nextIndex: belIdx + 1, complete: true, terminator: BEL }
		}

		if (escIdx !== -1) {
			if (escIdx + 1 >= data.length) {
				// ESC is the last char; we don't yet know if it starts an ST terminator.
				this._pendingOsc += data.substring(startIdx, escIdx)
				return { nextIndex: data.length, complete: false, pendingEsc: true }
			}

			this._pendingOsc += data.substring(startIdx, escIdx)
			if (data[escIdx + 1] === "\\") {
				return { nextIndex: escIdx + 2, complete: true, terminator: ST }
			}

			// Lone ESC inside the body: terminate the (malformed) sequence here.
			return { nextIndex: escIdx, complete: true }
		}

		// No terminator in this chunk; buffer the rest and wait for more data.
		this._pendingOsc += data.substring(startIdx)
		return { nextIndex: data.length, complete: false }
	}

	/**
	 * Process a complete OSC payload. If it's a 633; sequence, flush any pending
	 * text into a text segment, then push the event as an event segment (633
	 * sequences are stripped from cleaned output). For non-633 OSC, return the
	 * reconstructed original bytes so the caller appends them as text (they pass
	 * through unchanged).
	 *
	 * Returns the passthrough text for non-633 sequences, or `undefined` for 633
	 * sequences (nothing to append).
	 */
	private _handleOscPayload(
		payload: string,
		events: Osc633Event[],
		segments: Osc633Segment[],
		flushText: () => void,
		terminator = BEL,
	): string | undefined {
		if (payload.startsWith("633;")) {
			const event = parseOsc633Payload(payload.substring(4))
			if (event) {
				events.push(event)
				// Flush pending text before the event so segments stay ordered.
				flushText()
				segments.push({ kind: "event", event })
			}
			// 633 sequences are always stripped from output.
			return undefined
		}
		// Non-633 OSC: put the original bytes back as text.
		return OSC_START + payload + terminator
	}
}
