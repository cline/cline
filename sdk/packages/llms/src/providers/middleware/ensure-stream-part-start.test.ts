import { describe, expect, it } from "vitest";
import {
	ensureStreamPartStartMiddleware,
	isRecoverableAiSdkStreamPartError,
} from "./ensure-stream-part-start";

async function collectStream(
	stream: ReadableStream<{ type: string; id?: string; delta?: string }>,
): Promise<Array<{ type: string; id?: string; delta?: string }>> {
	const reader = stream.getReader();
	const out: Array<{ type: string; id?: string; delta?: string }> = [];
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		out.push(value);
	}
	return out;
}

function makeSourceStream(
	chunks: Array<{ type: string; id?: string; delta?: string }>,
) {
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(chunk);
			}
			controller.close();
		},
	});
}

describe("ensureStreamPartStartMiddleware", () => {
	it("inserts text-start before a bare text-delta", async () => {
		const source = makeSourceStream([
			{ type: "text-delta", id: "txt-0", delta: "hello" },
			{ type: "text-end", id: "txt-0" },
		]);
		const wrapped = await ensureStreamPartStartMiddleware.wrapStream?.({
			doGenerate: async () => {
				throw new Error("not used");
			},
			doStream: async () => ({ stream: source }),
			params: {} as never,
			model: {} as never,
		});
		expect(wrapped).toBeDefined();
		const events = await collectStream(wrapped!.stream);
		expect(events).toEqual([
			{ type: "text-start", id: "txt-0" },
			{ type: "text-delta", id: "txt-0", delta: "hello" },
			{ type: "text-end", id: "txt-0" },
		]);
	});

	it("does not duplicate an existing text-start", async () => {
		const source = makeSourceStream([
			{ type: "text-start", id: "txt-0" },
			{ type: "text-delta", id: "txt-0", delta: "ok" },
		]);
		const wrapped = await ensureStreamPartStartMiddleware.wrapStream?.({
			doGenerate: async () => {
				throw new Error("not used");
			},
			doStream: async () => ({ stream: source }),
			params: {} as never,
			model: {} as never,
		});
		const events = await collectStream(wrapped!.stream);
		expect(events).toEqual([
			{ type: "text-start", id: "txt-0" },
			{ type: "text-delta", id: "txt-0", delta: "ok" },
		]);
	});

	it("inserts reasoning-start before a bare reasoning-delta", async () => {
		const source = makeSourceStream([
			{ type: "reasoning-delta", id: "reasoning-0", delta: "think" },
		]);
		const wrapped = await ensureStreamPartStartMiddleware.wrapStream?.({
			doGenerate: async () => {
				throw new Error("not used");
			},
			doStream: async () => ({ stream: source }),
			params: {} as never,
			model: {} as never,
		});
		const events = await collectStream(wrapped!.stream);
		expect(events).toEqual([
			{ type: "reasoning-start", id: "reasoning-0" },
			{ type: "reasoning-delta", id: "reasoning-0", delta: "think" },
		]);
	});
});

describe("isRecoverableAiSdkStreamPartError", () => {
	it("matches AI SDK missing text part bookkeeping errors", () => {
		expect(
			isRecoverableAiSdkStreamPartError(
				new Error("text part msg_abc123 not found"),
			),
		).toBe(true);
		expect(
			isRecoverableAiSdkStreamPartError(
				new Error("reasoning part reasoning-0 not found"),
			),
		).toBe(true);
	});

	it("does not match unrelated errors", () => {
		expect(isRecoverableAiSdkStreamPartError(new Error("network timeout"))).toBe(
			false,
		);
	});
});
