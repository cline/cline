import type { HubTransportFrame } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	encodeHubFrame,
	HUB_FRAME_CHUNK_SIZE,
	HubFrameAssembler,
} from "./frame-chunks";

function commandFrame(prompt: string): HubTransportFrame {
	return {
		kind: "command",
		envelope: {
			version: "v1",
			command: "session.send_input",
			requestId: "req-1",
			clientId: "client-1",
			payload: { prompt },
		},
	};
}

describe("hub frame chunking", () => {
	it("leaves small frames as a single JSON message", () => {
		const frame = commandFrame("hello");
		const messages = encodeHubFrame(frame);
		expect(messages).toEqual([JSON.stringify(frame)]);
		expect(new HubFrameAssembler().push(messages[0] ?? "")).toEqual(frame);
	});

	it("splits large frames and reassembles them in order", () => {
		const frame = commandFrame("a".repeat(HUB_FRAME_CHUNK_SIZE * 2 + 10));
		const messages = encodeHubFrame(frame);
		expect(messages).toHaveLength(3);
		for (const message of messages) {
			expect(message.length).toBeLessThan(HUB_FRAME_CHUNK_SIZE * 1.5);
		}

		const assembler = new HubFrameAssembler();
		expect(assembler.push(messages[0] ?? "")).toBeUndefined();
		expect(assembler.push(messages[1] ?? "")).toBeUndefined();
		expect(assembler.push(messages[2] ?? "")).toEqual(frame);
	});

	it("never splits a surrogate pair across chunks", () => {
		// Place an astral code point exactly on the chunk boundary of the
		// serialized JSON so a naive slice would cut it in half.
		const json = JSON.stringify(commandFrame(""));
		const prefixLength = json.indexOf('"prompt":"') + '"prompt":"'.length;
		const prompt = `${"b".repeat(HUB_FRAME_CHUNK_SIZE - prefixLength - 1)}😀${"c".repeat(16)}`;
		const frame = commandFrame(prompt);
		const messages = encodeHubFrame(frame);
		expect(messages.length).toBeGreaterThan(1);
		for (const message of messages) {
			const data = (JSON.parse(message) as { data: string }).data;
			// A lone surrogate would not survive UTF-8 encoding.
			expect(Buffer.from(data, "utf8").toString("utf8")).toBe(data);
		}

		const assembler = new HubFrameAssembler();
		let result: HubTransportFrame | undefined;
		for (const message of messages) {
			result = assembler.push(message);
		}
		expect(result).toEqual(frame);
	});

	it("rejects malformed chunk descriptors", () => {
		const assembler = new HubFrameAssembler();
		expect(() =>
			assembler.push(
				JSON.stringify({
					kind: "chunk",
					id: "x",
					index: 5,
					total: 2,
					data: "",
				}),
			),
		).toThrow("Malformed hub frame chunk");
		expect(() =>
			assembler.push(
				JSON.stringify({
					kind: "chunk",
					id: "x",
					index: 0,
					total: 0,
					data: "",
				}),
			),
		).toThrow("Malformed hub frame chunk");
	});
});
