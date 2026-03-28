import { describe, expect, it, vi } from "vitest";
import type { AgentEvent, AgentResult } from "../types.js";
import {
	batchEvents,
	collectEvents,
	filterEvents,
	mapEvents,
	streamContinue,
	streamRun,
	streamText,
} from "./streaming.js";

class FakeAgent {
	config: { onEvent?: (event: AgentEvent) => void } = {};
	abort = vi.fn();
	private subscriberSeq = 0;
	private subscribers = new Map<number, (event: AgentEvent) => void>();
	private eventSequence: AgentEvent[];
	private result: AgentResult;

	constructor(eventSequence: AgentEvent[], result: AgentResult) {
		this.eventSequence = eventSequence;
		this.result = result;
	}

	getSubscriberCount(): number {
		return this.subscribers.size;
	}

	subscribeEvents(listener: (event: AgentEvent) => void): () => void {
		const id = ++this.subscriberSeq;
		this.subscribers.set(id, listener);
		return () => {
			this.subscribers.delete(id);
		};
	}

	private emit(event: AgentEvent): void {
		this.config.onEvent?.(event);
		for (const subscriber of this.subscribers.values()) {
			subscriber(event);
		}
	}

	async run(_message: string): Promise<AgentResult> {
		for (const event of this.eventSequence) {
			this.emit(event);
		}
		return this.result;
	}

	async continue(_message: string): Promise<AgentResult> {
		for (const event of this.eventSequence) {
			this.emit(event);
		}
		return this.result;
	}
}

class ErrorAgent extends FakeAgent {
	async run(_message: string): Promise<AgentResult> {
		throw new Error("run failed");
	}
}

const baseResult: AgentResult = {
	text: "done",
	usage: {
		inputTokens: 1,
		outputTokens: 2,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalCost: 0,
	},
	messages: [],
	toolCalls: [],
	iterations: 1,
	finishReason: "completed",
	model: {
		id: "model",
		provider: "mock",
	},
	startedAt: new Date(),
	endedAt: new Date(),
	durationMs: 1,
};

describe("streaming utilities", () => {
	it("streams run events and resolves final result", async () => {
		const events: AgentEvent[] = [
			{ type: "iteration_start", iteration: 1 },
			{
				type: "content_start",
				contentType: "text",
				text: "hello",
				accumulated: "hello",
			},
		];
		const agent = new FakeAgent(events, baseResult);
		const stream = streamRun(agent as never, "hello");

		const collected = await collectEvents(stream);
		const result = await stream.getResult();

		expect(collected).toEqual(events);
		expect(result).toEqual(baseResult);
	});

	it("supports continue path, abort, and event transforms", async () => {
		const events: AgentEvent[] = [
			{ type: "iteration_start", iteration: 1 },
			{
				type: "content_start",
				contentType: "text",
				text: "part-a",
				accumulated: "part-a",
			},
			{
				type: "content_start",
				contentType: "reasoning",
				reasoning: "thinking",
				redacted: false,
			},
		];
		const agent = new FakeAgent(events, baseResult);
		const stream = streamContinue(agent as never, "next");

		const textOnly: AgentEvent[] = [];
		for await (const event of filterEvents(stream, "content_start")) {
			if (event.contentType === "text") {
				textOnly.push(event);
			}
		}
		expect(textOnly).toHaveLength(1);

		const mapSource = streamRun(agent as never, "again");
		const mapped: string[] = [];
		for await (const entry of mapEvents(mapSource, (event) => event.type)) {
			mapped.push(entry);
		}
		expect(mapped).toEqual([
			"iteration_start",
			"content_start",
			"content_start",
		]);

		const batchSource = streamRun(agent as never, "batched");
		const batches: AgentEvent[][] = [];
		for await (const batch of batchEvents(batchSource, 2)) {
			batches.push(batch);
		}
		expect(batches.map((b) => b.length)).toEqual([2, 1]);

		const abortSource = streamRun(agent as never, "abort");
		abortSource.abort();
		expect(agent.abort).toHaveBeenCalledTimes(1);
	});

	it("streamText yields only text content chunks", async () => {
		const events: AgentEvent[] = [
			{
				type: "content_start",
				contentType: "reasoning",
				reasoning: "hidden",
				redacted: false,
			},
			{
				type: "content_start",
				contentType: "text",
				text: "hello ",
				accumulated: "hello ",
			},
			{
				type: "content_start",
				contentType: "text",
				text: "world",
				accumulated: "hello world",
			},
		];
		const agent = new FakeAgent(events, baseResult);

		const parts: string[] = [];
		for await (const text of streamText(agent as never, "text only")) {
			parts.push(text);
		}

		expect(parts).toEqual(["hello ", "world"]);
	});

	it("cleans up event subscription after stream failure", async () => {
		const agent = new ErrorAgent([], baseResult);
		const stream = streamRun(agent as never, "boom");

		await expect(stream.getResult()).rejects.toThrow("run failed");
		expect(agent.getSubscriberCount()).toBe(0);
	});
});
