import type { HubTransportFrame } from "@cline/shared";

/**
 * Bun caps inbound WebSocket messages at 16 MiB, and its `ws` shim ignores the
 * `maxPayload` option, so a Bun-hosted Hub (the desktop sidecar binary, the
 * compiled CLI) drops the socket with code 1006 "Received too big message"
 * when a single client frame exceeds that — e.g. `session.send_input`
 * carrying several pasted screenshots. Frames above this size travel as
 * `chunk` wire frames and are reassembled before they reach the handlers.
 *
 * Measured in UTF-16 code units: the UTF-8 encoding is at most 3x that, which
 * keeps every chunk well under the 16 MiB cap.
 */
export const HUB_FRAME_CHUNK_SIZE = 4 * 1024 * 1024;
/** Bounds per-connection reassembly memory (1 GiB of frame text). */
const HUB_FRAME_MAX_CHUNKS = 256;

interface HubFrameChunk {
	kind: "chunk";
	id: string;
	index: number;
	total: number;
	data: string;
}

function isHighSurrogate(code: number): boolean {
	return code >= 0xd800 && code <= 0xdbff;
}

/** Serializes a frame into one or more WebSocket text messages. */
export function encodeHubFrame(frame: HubTransportFrame): string[] {
	const json = JSON.stringify(frame);
	if (json.length <= HUB_FRAME_CHUNK_SIZE) {
		return [json];
	}
	const parts: string[] = [];
	for (let start = 0; start < json.length; ) {
		let end = Math.min(start + HUB_FRAME_CHUNK_SIZE, json.length);
		// A split surrogate pair would be replaced with U+FFFD when the text
		// frame is UTF-8 encoded, corrupting the reassembled JSON.
		if (end < json.length && isHighSurrogate(json.charCodeAt(end - 1))) {
			end -= 1;
		}
		parts.push(json.slice(start, end));
		start = end;
	}
	const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
	return parts.map((data, index) =>
		JSON.stringify({
			kind: "chunk",
			id,
			index,
			total: parts.length,
			data,
		} satisfies HubFrameChunk),
	);
}

/** Per-connection reassembly of frames split by {@link encodeHubFrame}. */
export class HubFrameAssembler {
	private readonly pending = new Map<
		string,
		{ parts: (string | undefined)[]; received: number }
	>();

	/**
	 * Parses one WebSocket text message. Returns the frame once it is complete,
	 * or `undefined` while chunks of it are still outstanding. Throws on
	 * malformed JSON, like `JSON.parse`.
	 */
	push(raw: string): HubTransportFrame | undefined {
		const parsed = JSON.parse(raw) as HubTransportFrame | HubFrameChunk;
		if (parsed.kind !== "chunk") {
			return parsed;
		}
		const { id, index, total, data } = parsed;
		if (
			typeof id !== "string" ||
			typeof data !== "string" ||
			!Number.isInteger(total) ||
			total < 1 ||
			total > HUB_FRAME_MAX_CHUNKS ||
			!Number.isInteger(index) ||
			index < 0 ||
			index >= total
		) {
			throw new Error("Malformed hub frame chunk");
		}
		let entry = this.pending.get(id);
		if (!entry) {
			entry = { parts: new Array<string | undefined>(total), received: 0 };
			this.pending.set(id, entry);
		}
		if (entry.parts[index] === undefined) {
			entry.received += 1;
		}
		entry.parts[index] = data;
		if (entry.received < total) {
			return undefined;
		}
		this.pending.delete(id);
		return JSON.parse(entry.parts.join("")) as HubTransportFrame;
	}
}
