/**
 * Differential harness: the v1 ACP translator (session-updates.ts
 * reference) vs the frame path (SessionFramer → StreamAssembler →
 * AcpStreamForwarder) must emit identical SessionUpdate sequences for
 * every trace.
 */
import type { AgentEvent } from "@cline/core";
import { generateLegalV1Trace } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { AcpStreamForwarder } from "./frame-forwarder";
import { forwardAgentEvent } from "./session-updates";
import type { SessionUpdate } from "@agentclientprotocol/sdk";

interface Capture {
	updates: Array<{ sessionId: string; update: SessionUpdate }>;
}

const makeCapture = (): Capture & {
	sessionUpdate(params: {
		sessionId: string;
		update: SessionUpdate;
	}): Promise<unknown>;
} => {
	const capture: Capture & {
		sessionUpdate(params: {
			sessionId: string;
			update: SessionUpdate;
		}): Promise<unknown>;
	} = {
		updates: [],
		sessionUpdate(params) {
			this.updates.push(params);
			return Promise.resolve({});
		},
	};
	return capture;
};

function renderV1(trace: AgentEvent[]): SessionUpdate[] {
	const capture = makeCapture();
	for (const event of trace) {
		forwardAgentEvent(capture, "s1", event);
	}
	return capture.updates.map((entry) => entry.update);
}

function renderV2(trace: AgentEvent[]): SessionUpdate[] {
	const capture = makeCapture();
	const forwarder = new AcpStreamForwarder(capture, "s1");
	for (const event of trace) {
		forwarder.pushEvent(event);
	}
	return capture.updates.map((entry) => entry.update);
}

describe("ACP forwarder differential — v1 reference vs frame path", () => {
	it("generated traces emit identical SessionUpdate sequences", () => {
		for (let seed = 1; seed <= 100; seed += 1) {
			const trace = generateLegalV1Trace(seed, { maxEvents: 60 });
			expect(renderV1(trace), `seed ${seed}`).toEqual(renderV2(trace));
		}
	});

	it("handcrafted edges emit identical sequences: media, tool error, empty reasoning", () => {
		const trace: AgentEvent[] = [
			{ type: "iteration_start", iteration: 1 },
			{
				type: "content_start",
				contentType: "reasoning",
				redacted: true,
			},
			{
				type: "content_start",
				contentType: "text",
				text: "Answer",
			},
			{
				type: "content_end",
				contentType: "text",
				text: "Answer",
			},
			{
				type: "content_start",
				contentType: "tool",
				toolCallId: "t1",
				toolName: "run_commands",
				input: { command: "ls" },
			},
			{
				type: "content_end",
				contentType: "tool",
				toolCallId: "t1",
				toolName: "run_commands",
				error: "boom",
			},
			{
				type: "content_end",
				contentType: "media",
				media: {
					id: "m1",
					modality: "image",
					mediaType: "image/png",
					source: { type: "base64", data: "aGk=" },
				} as never,
			},
			{
				type: "done",
				reason: "completed",
				text: "ok",
				iterations: 1,
			},
		];
		const v1 = renderV1(trace);
		const v2 = renderV2(trace);
		expect(v1).toEqual(v2);
		// The sequence is what v1 produced: the "Answer" text chunk, the
		// pending tool_call, the failed update, the image chunk — no
		// thought chunk (the redacted marker is empty and skipped), no
		// done artifact.
		expect(v2).toHaveLength(4);
		expect(v2[0]).toMatchObject({ sessionUpdate: "agent_message_chunk" });
		expect(v2[1]).toMatchObject({ sessionUpdate: "tool_call", status: "pending" });
		expect(v2[2]).toMatchObject({
			sessionUpdate: "tool_call_update",
			status: "failed",
		});
		expect(v2[3]).toMatchObject({ sessionUpdate: "agent_message_chunk" });
	});
});
