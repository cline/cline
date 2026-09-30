import { randomUUID } from "node:crypto";

export const TOOL_RESULT_CACHE_MAX_BYTES = 16 * 1024 * 1024;
export const TOOL_RESULT_CACHE_IDLE_ITERATIONS = 5;
export const TOOL_RESULT_CACHE_MISS =
	"Cache not found. Make a new tool call for the latest result again if needed. DO NOT repeat side-effecting actions to recover output.";

interface CachedResult {
	toolCallId: string;
	uri: string;
	text: string;
	bytes: number;
	lastReadIteration: number;
}

/** Session-owned volatile text cache. Looking up a URI never extends its lifetime. */
export class ToolResultCache {
	private readonly entries = new Map<string, CachedResult>();
	private readonly idsByToolCall = new Map<string, string>();
	private iteration = 0;
	private bytes = 0;

	constructor(
		private readonly sessionId: string,
		private readonly maxBytes = TOOL_RESULT_CACHE_MAX_BYTES,
	) {}

	store(toolCallId: string, text: string): string | undefined {
		const bytes = Buffer.byteLength(text);
		const previous = this.idsByToolCall.get(toolCallId);
		if (previous) this.remove(previous);
		if (bytes > this.maxBytes) return undefined;
		while (this.bytes + bytes > this.maxBytes) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) break;
			this.remove(oldest);
		}
		const id = randomUUID();
		const uri = `cline://cache/${encodeURIComponent(this.sessionId)}/${id}.result.txt`;
		this.entries.set(id, {
			toolCallId,
			uri,
			text,
			bytes,
			lastReadIteration: this.iteration,
		});
		this.idsByToolCall.set(toolCallId, id);
		this.bytes += bytes;
		return uri;
	}

	uriFor(toolCallId: string): string | undefined {
		const id = this.idsByToolCall.get(toolCallId);
		return id ? this.entries.get(id)?.uri : undefined;
	}

	read(uri: string): string {
		const match = /^cline:\/\/cache\/([^/]+)\/([a-f0-9-]+)\.result\.txt$/.exec(
			uri,
		);
		if (!match || decodeURIComponent(match[1]) !== this.sessionId) {
			throw new Error("Invalid tool result cache URI for this session");
		}
		const entry = this.entries.get(match[2]);
		if (!entry) throw new Error(TOOL_RESULT_CACHE_MISS);
		entry.lastReadIteration = this.iteration;
		// Explicit reads refresh LRU order. Model projection calls only uriFor.
		this.entries.delete(match[2]);
		this.entries.set(match[2], entry);
		return entry.text;
	}

	advanceIteration(): void {
		this.iteration++;
		for (const [id, entry] of this.entries) {
			if (
				this.iteration - entry.lastReadIteration >=
				TOOL_RESULT_CACHE_IDLE_ITERATIONS
			)
				this.remove(id);
		}
	}

	clear(): void {
		this.entries.clear();
		this.idsByToolCall.clear();
		this.bytes = 0;
	}

	private remove(id: string): void {
		const entry = this.entries.get(id);
		if (!entry) return;
		this.bytes -= entry.bytes;
		this.idsByToolCall.delete(entry.toolCallId);
		this.entries.delete(id);
	}
}
