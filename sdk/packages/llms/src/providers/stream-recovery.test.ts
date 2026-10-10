import { describe, expect, it } from "vitest";
import { StreamRecovery } from "./stream-recovery";
import type { AiSdkStreamPart } from "./vendors/types";

describe("StreamRecovery", () => {
	it("drains a burst larger than its callback buffer without duplicating parts", async () => {
		const recovery = new StreamRecovery(2);
		async function* source() {
			for (let index = 0; index < 200; index++) {
				const part = { type: "text-delta", text: String(index) };
				await recovery.onChunk(part);
				yield part;
			}
		}
		const parts: AiSdkStreamPart[] = [];
		for await (const part of recovery.stream(source())) parts.push(part);
		expect(parts).toHaveLength(200);
		expect(parts.map((part) => part.text)).toEqual(
			Array.from({ length: 200 }, (_, index) => String(index)),
		);
	});

	it("resets retry numbers for a new step and never announces request-start retries", async () => {
		const recovery = new StreamRecovery(2);
		async function* source() {
			for (let step = 0; step < 2; step++) {
				recovery.onStepStart();
				recovery.onCallStart();
				recovery.onCallStart();
				recovery.onError("EOF");
				recovery.onCallStart();
				recovery.onStepEnd();
			}
			yield { type: "finish", finishReason: "stop" };
		}
		const parts: AiSdkStreamPart[] = [];
		for await (const part of recovery.stream(source())) parts.push(part);
		expect(
			parts
				.filter((part) => part.type === "stream-retry")
				.map((part) => part.attempt),
		).toEqual([1, 1]);
	});
	it("orders retries between attempts without duplicating callback-observed parts", async () => {
		const recovery = new StreamRecovery(2);
		async function* source() {
			recovery.onStepStart();
			const partial = { type: "text-delta", text: "Partial" };
			await recovery.onChunk(partial);
			yield partial;
			recovery.onError("EOF");
			recovery.onCallStart();
			const completed = { type: "text-delta", text: "Complete" };
			await recovery.onChunk(completed);
			yield completed;
			recovery.onStepEnd();
			yield { type: "finish", finishReason: "stop" };
		}
		const parts: AiSdkStreamPart[] = [];
		for await (const part of recovery.stream(source())) parts.push(part);
		expect(parts).toEqual([
			{ type: "text-delta", text: "Partial" },
			{ type: "stream-retry", error: "EOF", attempt: 1, maxRetries: 2 },
			{ type: "text-delta", text: "Complete" },
			{ type: "response-checkpoint" },
			{ type: "finish", finishReason: "stop" },
		]);
	});

	it("does not announce a retry until another provider attempt starts", async () => {
		const recovery = new StreamRecovery(0);
		async function* source() {
			recovery.onError("EOF");
			yield { type: "error", error: "EOF" };
		}
		const parts: AiSdkStreamPart[] = [];
		for await (const part of recovery.stream(source())) parts.push(part);
		expect(parts).toEqual([{ type: "error", error: "EOF" }]);
	});

	it("propagates a source failure after its already-emitted parts", async () => {
		const recovery = new StreamRecovery(2);
		async function* source() {
			yield { type: "text-delta", text: "Partial" };
			throw new Error("Network died");
		}
		const iterator = recovery.stream(source())[Symbol.asyncIterator]();
		expect((await iterator.next()).value).toEqual({
			type: "text-delta",
			text: "Partial",
		});
		await expect(iterator.next()).rejects.toThrow("Network died");
	});

	it("lets a consumer stop while the upstream is still waiting", async () => {
		const recovery = new StreamRecovery(2);
		let finish: (() => void) | undefined;
		async function* source() {
			yield { type: "text-delta", text: "Partial" };
			await new Promise<void>((resolve) => {
				finish = resolve;
			});
		}
		const iterator = recovery.stream(source())[Symbol.asyncIterator]();
		await iterator.next();
		await iterator.return?.();
		finish?.();
	});
});
