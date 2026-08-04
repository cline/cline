/**
 * Repairs malformed streaming tool-call deltas from OpenAI-compatible
 * endpoints before the AI SDK parses them.
 *
 * `@ai-sdk/openai-compatible` hands tool-call deltas to the shared
 * `StreamingToolCallTracker`, which throws
 * `InvalidResponseDataError: Expected 'function.name' to be a string.` when a
 * delta starts a *new* tool call without a `function.name`. Two real-world
 * server behaviors trigger that:
 *
 * 1. Servers that omit `index` on tool-call deltas. The first delta (carrying
 *    the name) is tracked at index 0, but the follow-up argument delta —
 *    also without an `index` — is treated as a brand-new tool call and the
 *    tracker throws (the name only ever arrives on the first chunk).
 * 2. Servers whose tool-call parser never emits a name at all (e.g. a
 *    server-side parse of malformed model output). The provider buffers those
 *    deltas and deliberately re-throws the same error at stream end.
 *
 * The classic (pre-SDK) extension's `ToolCallProcessor` tolerated both:
 * deltas were accumulated per index with a positional fallback, and calls
 * that never received a name were silently dropped rather than failing the
 * whole turn. This module restores that leniency at the wire level: it
 * rewrites the SSE response so every forwarded tool-call delta carries a
 * contiguous `index` and a `function.name`, buffering nameless deltas until
 * their name arrives and dropping calls whose name never does.
 */

type ToolCallDeltaEntry = {
	index?: number | null;
	id?: string | null;
	type?: string | null;
	function?: {
		name?: string | null;
		arguments?: string | null;
	} | null;
} & Record<string, unknown>;

interface ToolCallState {
	/** True once the call has been forwarded with a name. */
	named: boolean;
	/** Contiguous output index assigned when the call is first forwarded. */
	outIndex: number | undefined;
	/** Last known id for the call (ids may arrive before the name). */
	id: string | null;
	/** Argument text buffered while the name is still unknown. */
	bufferedArguments: string;
	/** Non-function fields buffered while the name is still unknown. */
	bufferedRest: Record<string, unknown>;
}

const IGNORED_ENTRY_KEYS = new Set(["index", "id", "type", "function"]);

/**
 * Stateful per-response repairer for `choices[].delta.tool_calls` entries.
 * Exported for tests; production use goes through
 * `createToolCallDeltaRepairFetch`.
 */
export class ToolCallDeltaRepairer {
	private readonly states = new Map<string, ToolCallState>();
	private readonly keyById = new Map<string, string>();
	private lastKey: string | undefined;
	private nextAnonymousKey = 0;
	private outCount = 0;

	/**
	 * Repair one chunk's tool-call delta entries. Returns the entries to
	 * forward (possibly fewer than the input when nameless deltas are
	 * buffered, or more content merged in when a buffered call gains its
	 * name).
	 */
	repairEntries(entries: ToolCallDeltaEntry[]): ToolCallDeltaEntry[] {
		const out: ToolCallDeltaEntry[] = [];
		for (const entry of entries) {
			const repaired = this.repairEntry(entry);
			if (repaired) {
				out.push(repaired);
			}
		}
		return out;
	}

	private repairEntry(
		entry: ToolCallDeltaEntry,
	): ToolCallDeltaEntry | undefined {
		const key = this.resolveKey(entry);
		this.lastKey = key;
		let state = this.states.get(key);
		if (!state) {
			state = {
				named: false,
				outIndex: undefined,
				id: null,
				bufferedArguments: "",
				bufferedRest: {},
			};
			this.states.set(key, state);
		}
		if (typeof entry.id === "string" && entry.id.length > 0) {
			state.id ??= entry.id;
			this.keyById.set(entry.id, key);
		}

		if (state.named) {
			return { ...entry, index: state.outIndex };
		}

		const name = entry.function?.name;
		if (typeof name === "string" && name.length > 0) {
			state.named = true;
			state.outIndex = this.outCount++;
			const argumentsDelta = entry.function?.arguments;
			const mergedArguments =
				state.bufferedArguments.length > 0
					? state.bufferedArguments + (argumentsDelta ?? "")
					: argumentsDelta;
			const merged: ToolCallDeltaEntry = {
				...state.bufferedRest,
				...entry,
				index: state.outIndex,
				function: {
					...entry.function,
					name,
					...(mergedArguments != null ? { arguments: mergedArguments } : {}),
				},
			};
			if (merged.id == null && state.id != null) {
				merged.id = state.id;
			}
			state.bufferedArguments = "";
			state.bufferedRest = {};
			return merged;
		}

		// Nameless delta for a call that has not been forwarded yet: buffer it
		// until (unless) the name arrives. Calls that never receive a name are
		// dropped, matching the classic extension's ToolCallProcessor.
		state.bufferedArguments += entry.function?.arguments ?? "";
		for (const [entryKey, value] of Object.entries(entry)) {
			if (!IGNORED_ENTRY_KEYS.has(entryKey) && value != null) {
				state.bufferedRest[entryKey] = value;
			}
		}
		return undefined;
	}

	private resolveKey(entry: ToolCallDeltaEntry): string {
		if (typeof entry.index === "number") {
			return `server:${entry.index}`;
		}
		if (typeof entry.id === "string" && entry.id.length > 0) {
			return this.keyById.get(entry.id) ?? `id:${entry.id}`;
		}
		const name = entry.function?.name;
		const hasName = typeof name === "string" && name.length > 0;
		// A delta with neither index, id, nor name continues the most recent
		// tool call (servers that omit `index` stream one call at a time).
		if (!hasName && this.lastKey !== undefined) {
			return this.lastKey;
		}
		this.nextAnonymousKey += 1;
		return `anonymous:${this.nextAnonymousKey}`;
	}
}

interface SseChunk {
	choices?: Array<
		{
			delta?: {
				tool_calls?: ToolCallDeltaEntry[];
			} & Record<string, unknown>;
		} & Record<string, unknown>
	> | null;
}

function repairSseDataPayload(
	payload: string,
	repairer: ToolCallDeltaRepairer,
): string | undefined {
	if (!payload.includes("tool_calls")) {
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(payload);
	} catch {
		return undefined;
	}
	if (parsed === null || typeof parsed !== "object") {
		return undefined;
	}
	const chunk = parsed as SseChunk;
	if (!Array.isArray(chunk.choices)) {
		return undefined;
	}
	let changed = false;
	for (const choice of chunk.choices) {
		const delta = choice?.delta;
		const toolCalls = delta?.tool_calls;
		if (!delta || !Array.isArray(toolCalls) || toolCalls.length === 0) {
			continue;
		}
		delta.tool_calls = repairer.repairEntries(toolCalls);
		changed = true;
	}
	return changed ? JSON.stringify(chunk) : undefined;
}

function createRepairTransform(): TransformStream<Uint8Array, Uint8Array> {
	const repairer = new ToolCallDeltaRepairer();
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	let buffered = "";

	const processLine = (line: string): string => {
		const hadCarriageReturn = line.endsWith("\r");
		const core = hadCarriageReturn ? line.slice(0, -1) : line;
		if (!core.startsWith("data:")) {
			return line;
		}
		let payload = core.slice("data:".length);
		if (payload.startsWith(" ")) {
			payload = payload.slice(1);
		}
		if (payload === "[DONE]") {
			return line;
		}
		const repaired = repairSseDataPayload(payload, repairer);
		if (repaired === undefined) {
			return line;
		}
		return `data: ${repaired}${hadCarriageReturn ? "\r" : ""}`;
	};

	return new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			buffered += decoder.decode(chunk, { stream: true });
			const lines = buffered.split("\n");
			buffered = lines.pop() ?? "";
			for (const line of lines) {
				controller.enqueue(encoder.encode(`${processLine(line)}\n`));
			}
		},
		flush(controller) {
			buffered += decoder.decode();
			if (buffered.length > 0) {
				controller.enqueue(encoder.encode(processLine(buffered)));
			}
			// Tool calls that never received a name stay buffered in the
			// repairer and are dropped here by not being emitted.
		},
	});
}

function isEventStreamResponse(response: Response): boolean {
	const contentType = response.headers.get("content-type") ?? "";
	return contentType.toLowerCase().includes("text/event-stream");
}

type FetchWithOptionalPreconnect = typeof fetch & {
	preconnect?: (...args: unknown[]) => unknown;
};

/**
 * Wrap a fetch implementation so OpenAI-compatible SSE responses get their
 * streaming tool-call deltas repaired before the AI SDK parses them.
 * Non-streaming responses pass through untouched.
 */
export function createToolCallDeltaRepairFetch(
	baseFetch: typeof fetch,
): typeof fetch {
	const repairFetch = (async (input, init) => {
		const response = await baseFetch(input, init);
		if (!response.ok || !response.body || !isEventStreamResponse(response)) {
			return response;
		}
		return new Response(response.body.pipeThrough(createRepairTransform()), {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	}) as typeof fetch;

	const baseFetchWithPreconnect = baseFetch as FetchWithOptionalPreconnect;
	(repairFetch as FetchWithOptionalPreconnect).preconnect =
		typeof baseFetchWithPreconnect.preconnect === "function"
			? baseFetchWithPreconnect.preconnect.bind(baseFetch)
			: () => undefined;
	return repairFetch;
}
