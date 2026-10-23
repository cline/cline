const textDecoder = new TextDecoder();

function isArrayBufferView(value: unknown): value is ArrayBufferView {
	return (
		typeof ArrayBuffer !== "undefined" &&
		typeof ArrayBuffer.isView === "function" &&
		ArrayBuffer.isView(value)
	);
}

function isBlobLike(value: unknown): boolean {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function"
	);
}

function toBytes(value: unknown): Uint8Array | undefined {
	if (value instanceof ArrayBuffer) {
		return new Uint8Array(value);
	}
	if (isArrayBufferView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	}
	return undefined;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
	const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return merged;
}

/**
 * Decode a websocket `message` payload into text without depending on Node's
 * `Buffer`. Returns `undefined` when the payload cannot be decoded
 * synchronously (e.g. a browser `Blob`), so callers can drop the frame and
 * report a diagnostic instead of parsing garbage.
 */
export function decodeSocketText(data: unknown): string | undefined {
	if (typeof data === "string") {
		return data;
	}
	if (data === null || data === undefined) {
		return undefined;
	}
	const bytes = toBytes(data);
	if (bytes) {
		return textDecoder.decode(bytes);
	}
	if (Array.isArray(data)) {
		const chunks: Uint8Array[] = [];
		for (const chunk of data) {
			const chunkBytes = toBytes(chunk);
			if (!chunkBytes) {
				// Mixed/unknown fragment list: fall back to per-chunk decoding so a
				// stringly-typed fragment still contributes its text.
				return data.map((entry) => decodeSocketText(entry) ?? "").join("");
			}
			chunks.push(chunkBytes);
		}
		// Concatenate before decoding so multi-byte UTF-8 sequences that straddle a
		// fragment boundary are not mangled.
		return textDecoder.decode(concatBytes(chunks));
	}
	if (isBlobLike(data)) {
		return undefined;
	}
	if (
		typeof data === "object" &&
		"data" in data &&
		typeof (data as { data?: unknown }).data !== "undefined"
	) {
		return decodeSocketText((data as { data?: unknown }).data);
	}
	if (typeof data === "object") {
		return undefined;
	}
	return String(data);
}

export function decodeCloseReason(reason: unknown): string {
	if (typeof reason === "string") {
		return reason;
	}
	const bytes = toBytes(reason);
	return bytes ? textDecoder.decode(bytes) : "";
}
