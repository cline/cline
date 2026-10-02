import { randomUUID } from "node:crypto";
import type { ImageContent } from "@cline/shared";
import YAML from "yaml";

export const TOOL_RESULT_CACHE_MAX_BYTES = 16 * 1024 * 1024;
export const TOOL_RESULT_CACHE_IDLE_ITERATIONS = 5;
export const TOOL_RESULT_CACHE_MISS =
	"Cache not found. Make a new tool call for the latest result again if needed. DO NOT repeat side-effecting actions to recover output.";

interface CachedResult {
	text: string;
	bytes: number;
	lastReadIteration: number;
}

/** Session-owned volatile text cache. Looking up a URI never extends its lifetime. */
export class ToolResultCache {
	private readonly entries = new Map<string, CachedResult>();
	// References outlive cached content so eviction never rewrites old notices.
	private readonly referencesByToolCall = new Map<
		string,
		{ id: string; uri: string }
	>();
	private iteration = 0;
	private bytes = 0;

	constructor(
		private readonly sessionId: string,
		private readonly maxBytes = TOOL_RESULT_CACHE_MAX_BYTES,
	) {}

	store(toolCallId: string, text: string): string | undefined {
		const bytes = Buffer.byteLength(text);
		const previous = this.referencesByToolCall.get(toolCallId);
		if (previous) this.remove(previous.id);
		this.referencesByToolCall.delete(toolCallId);
		if (bytes > this.maxBytes) return undefined;
		while (this.bytes + bytes > this.maxBytes) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) break;
			this.remove(oldest);
		}
		const id = randomUUID();
		const uri = `cline://cache/${encodeURIComponent(this.sessionId)}/${id}.result.txt`;
		this.entries.set(id, {
			text,
			bytes,
			lastReadIteration: this.iteration,
		});
		this.referencesByToolCall.set(toolCallId, { id, uri });
		this.bytes += bytes;
		return uri;
	}

	uriFor(toolCallId: string): string | undefined {
		return this.referencesByToolCall.get(toolCallId)?.uri;
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
		this.referencesByToolCall.clear();
		this.bytes = 0;
	}

	private remove(id: string): void {
		const entry = this.entries.get(id);
		if (!entry) return;
		this.bytes -= entry.bytes;
		this.entries.delete(id);
	}
}

/** Keep native images on the media path for both text representations. */
function splitToolResultMedia(output: unknown): {
	textual: unknown;
	images: ImageContent[];
} {
	const images: ImageContent[] = [];
	function extract(value: unknown): unknown {
		if (value !== null && typeof value === "object") {
			if (
				"type" in value &&
				value.type === "image" &&
				"data" in value &&
				typeof value.data === "string"
			) {
				if ("mediaType" in value && typeof value.mediaType === "string") {
					images.push(value as ImageContent);
					return "[image attached]";
				}
				if ("mimeType" in value && typeof value.mimeType === "string") {
					images.push({
						type: "image",
						data: value.data,
						mediaType: value.mimeType,
					});
					return "[image attached]";
				}
			}
			if (Array.isArray(value)) return value.map(extract);
			return Object.fromEntries(
				Object.entries(value).map(([key, entry]) => [key, extract(entry)]),
			);
		}
		return value;
	}
	return { textual: extract(output), images };
}

/** Size and truncate the persisted representation sent to the model. */
export function prepareToolResultPreview(content: unknown): {
	text: string | undefined;
	images: ImageContent[];
} {
	const { textual, images } = splitToolResultMedia(content);
	return {
		text:
			typeof textual === "string" ? textual : JSON.stringify(textual, null, 2),
		images,
	};
}

/** YAML is only the readable recovery copy, not the truncation threshold. */
export function prepareToolResultRecovery(output: unknown): {
	text: string | undefined;
	images: ImageContent[];
} {
	const { textual, images } = splitToolResultMedia(output);
	return {
		text:
			typeof textual === "string"
				? textual
				: textual === undefined
					? undefined
					: YAML.stringify(textual, { blockQuote: "literal", lineWidth: 0 }),
		images,
	};
}
