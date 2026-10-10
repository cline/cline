import { describe, expect, it } from "vitest";
import { FramedMessageParser } from "./framed-message-parser";

function frame(body: string): Buffer {
	const bytes = Buffer.from(body, "utf8");
	return Buffer.concat([
		Buffer.from(`Content-Length: ${bytes.byteLength}\r\n\r\n`, "latin1"),
		bytes,
	]);
}

const ASCII_BODY = JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} });
// 2-byte (é), 3-byte (世, 界) and 4-byte (🚀) UTF-8 sequences.
const MULTIBYTE_BODY = JSON.stringify({
	jsonrpc: "2.0",
	id: 2,
	result: { text: "héllo 世界 🚀" },
});

describe("FramedMessageParser", () => {
	it("emits a frame delivered in one chunk", () => {
		const parser = new FramedMessageParser();
		expect(parser.push(frame(ASCII_BODY))).toEqual([ASCII_BODY]);
		expect(parser.bufferedByteLength).toBe(0);
	});

	it("uses Content-Length as a byte count for multibyte bodies", () => {
		const parser = new FramedMessageParser();
		expect(parser.push(frame(MULTIBYTE_BODY))).toEqual([MULTIBYTE_BODY]);
		expect(parser.bufferedByteLength).toBe(0);
	});

	it("reassembles a frame split at every possible byte offset", () => {
		const bytes = frame(MULTIBYTE_BODY);
		for (let split = 1; split < bytes.length; split++) {
			const parser = new FramedMessageParser();
			expect(parser.push(bytes.subarray(0, split))).toEqual([]);
			expect(parser.bufferedByteLength).toBe(split);
			expect(parser.push(bytes.subarray(split))).toEqual([MULTIBYTE_BODY]);
			expect(parser.bufferedByteLength).toBe(0);
		}
	});

	it("keeps 1, 2 or 3 bytes of a split 4-byte character buffered", () => {
		const bytes = frame(MULTIBYTE_BODY);
		const emojiStart = bytes.indexOf(Buffer.from("🚀", "utf8"));
		expect(emojiStart).toBeGreaterThan(0);
		for (const partialBytes of [1, 2, 3]) {
			const parser = new FramedMessageParser();
			const split = emojiStart + partialBytes;
			expect(parser.push(bytes.subarray(0, split))).toEqual([]);
			expect(parser.bufferedByteLength).toBe(split);
			expect(parser.push(bytes.subarray(split))).toEqual([MULTIBYTE_BODY]);
		}
	});

	it("reassembles a frame delivered one byte at a time", () => {
		const parser = new FramedMessageParser();
		const bytes = frame(MULTIBYTE_BODY);
		const messages: string[] = [];
		for (let i = 0; i < bytes.length; i++) {
			messages.push(...parser.push(bytes.subarray(i, i + 1)));
		}
		expect(messages).toEqual([MULTIBYTE_BODY]);
		expect(parser.bufferedByteLength).toBe(0);
	});

	it("emits several frames delivered in one chunk", () => {
		const parser = new FramedMessageParser();
		const chunk = Buffer.concat([
			frame(MULTIBYTE_BODY),
			frame(ASCII_BODY),
			frame(MULTIBYTE_BODY),
		]);
		expect(parser.push(chunk)).toEqual([
			MULTIBYTE_BODY,
			ASCII_BODY,
			MULTIBYTE_BODY,
		]);
		expect(parser.bufferedByteLength).toBe(0);
	});

	it.each([
		{ name: "no bytes", trailing: 0 },
		{ name: "one byte", trailing: 1 },
		{ name: "several header bytes", trailing: 10 },
	])("buffers $name of the next frame after a complete one", ({ trailing }) => {
		const parser = new FramedMessageParser();
		const next = frame(MULTIBYTE_BODY);
		const chunk = Buffer.concat([
			frame(ASCII_BODY),
			next.subarray(0, trailing),
		]);
		expect(parser.push(chunk)).toEqual([ASCII_BODY]);
		expect(parser.bufferedByteLength).toBe(trailing);
		expect(parser.push(next.subarray(trailing))).toEqual([MULTIBYTE_BODY]);
		expect(parser.bufferedByteLength).toBe(0);
	});

	it("buffers the next frame's header and part of a multibyte character", () => {
		const parser = new FramedMessageParser();
		const next = frame(MULTIBYTE_BODY);
		// End the chunk after the first byte of the 3-byte "世".
		const trailing = next.indexOf(Buffer.from("世", "utf8")) + 1;
		expect(
			parser.push(
				Buffer.concat([frame(ASCII_BODY), next.subarray(0, trailing)]),
			),
		).toEqual([ASCII_BODY]);
		expect(parser.bufferedByteLength).toBe(trailing);
		expect(parser.push(next.subarray(trailing))).toEqual([MULTIBYTE_BODY]);
	});

	it("rejects a header block without Content-Length", () => {
		const parser = new FramedMessageParser();
		expect(() =>
			parser.push(Buffer.from("Content-Type: application/json\r\n\r\n{}")),
		).toThrow("missing Content-Length header");
	});
});
