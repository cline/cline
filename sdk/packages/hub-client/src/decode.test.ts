import { describe, expect, it } from "vitest";
import { decodeCloseReason, decodeSocketText } from "./decode";

const encoder = new TextEncoder();

describe("decodeSocketText", () => {
	it("returns strings untouched", () => {
		expect(decodeSocketText('{"kind":"event"}')).toBe('{"kind":"event"}');
	});

	it("decodes Uint8Array payloads", () => {
		expect(decodeSocketText(encoder.encode("héllo ✓"))).toBe("héllo ✓");
	});

	it("decodes ArrayBuffer payloads", () => {
		const bytes = encoder.encode("héllo ✓");
		const buffer = bytes.buffer.slice(
			bytes.byteOffset,
			bytes.byteOffset + bytes.byteLength,
		);
		expect(decodeSocketText(buffer)).toBe("héllo ✓");
	});

	it("decodes a Uint8Array view over a larger buffer", () => {
		const bytes = encoder.encode("XXhéllo");
		const view = new Uint8Array(bytes.buffer, 2, bytes.byteLength - 2);
		expect(decodeSocketText(view)).toBe("héllo");
	});

	it("joins chunked frames across a multi-byte UTF-8 boundary", () => {
		const bytes = encoder.encode("héllo ✓");
		// Split inside the two-byte "é" sequence (index 1..2).
		const head = bytes.slice(0, 2);
		const tail = bytes.slice(2);
		expect(head.byteLength + tail.byteLength).toBe(bytes.byteLength);
		expect(decodeSocketText([head, tail])).toBe("héllo ✓");
	});

	it("unwraps MessageEvent-like objects", () => {
		expect(decodeSocketText({ data: '{"kind":"reply"}' })).toBe(
			'{"kind":"reply"}',
		);
		expect(decodeSocketText({ data: encoder.encode("ok") })).toBe("ok");
	});

	it("returns undefined for Blob-like payloads it cannot decode synchronously", () => {
		expect(decodeSocketText({ arrayBuffer: () => Promise.resolve(null) })).toBe(
			undefined,
		);
		expect(
			decodeSocketText({ data: { arrayBuffer: () => Promise.resolve(null) } }),
		).toBe(undefined);
	});

	it("returns undefined for nullish payloads", () => {
		expect(decodeSocketText(undefined)).toBe(undefined);
		expect(decodeSocketText(null)).toBe(undefined);
	});
});

describe("decodeCloseReason", () => {
	it("decodes string and binary reasons", () => {
		expect(decodeCloseReason("bye")).toBe("bye");
		expect(decodeCloseReason(encoder.encode("bye"))).toBe("bye");
		const bytes = encoder.encode("bye");
		expect(
			decodeCloseReason(
				bytes.buffer.slice(
					bytes.byteOffset,
					bytes.byteOffset + bytes.byteLength,
				),
			),
		).toBe("bye");
	});

	it("returns an empty string for unknown reasons", () => {
		expect(decodeCloseReason(undefined)).toBe("");
		expect(decodeCloseReason(42)).toBe("");
	});
});
