import type { AgentMessage, AgentRunResult } from "@cline/shared";
import { describe, expect, it } from "vitest";
import type {
	ArtifactSinkStatus,
	ComputerTaskArtifactEvent,
} from "./artifact-events";
import { ComputerTaskArtifactRecorder } from "./recorder";
import { createTranscriptRecordingHooks } from "./transcript-observer";

function makeRecorder() {
	const events: ComputerTaskArtifactEvent[] = [];
	const recorder = new ComputerTaskArtifactRecorder("art_test", {
		emit: (event) => {
			events.push(event);
		},
		flush: async (): Promise<ArtifactSinkStatus> => ({
			status: "complete",
			lastClientSequence: events.length,
			lastAcknowledgedSequence: events.length,
		}),
	});
	return { recorder, events };
}

function makeMessage(
	role: AgentMessage["role"],
	content: AgentMessage["content"],
): AgentMessage {
	return { id: "msg_1", role, content, createdAt: 0 };
}

const snapshot = { agentId: "agent-1" } as never;

describe("createTranscriptRecordingHooks", () => {
	it("records committed user, assistant, and tool messages", async () => {
		const { recorder, events } = makeRecorder();
		const hooks = createTranscriptRecordingHooks(recorder, {
			kind: "driver",
		});

		await hooks.onEvent?.({
			type: "message-added",
			snapshot,
			message: makeMessage("user", [
				{ type: "text", text: "Open the settings page" },
			]),
		});
		await hooks.onEvent?.({
			type: "message-added",
			snapshot,
			message: makeMessage("assistant", [
				{ type: "text", text: "Opening it now." },
				{
					type: "tool-call",
					toolCallId: "call_1",
					toolName: "computer",
					input: { action: "left_click", coordinate: [10, 20] },
				},
			]),
		});
		await hooks.onEvent?.({
			type: "message-added",
			snapshot,
			message: makeMessage("tool", [
				{
					type: "tool-result",
					toolCallId: "call_1",
					toolName: "computer",
					output: "clicked",
				},
			]),
		});
		// Non-message events stay out of the journal.
		await hooks.onEvent?.({ type: "run-started", snapshot });

		expect(events.map((event) => event.payload.role)).toEqual([
			"user",
			"assistant",
			"tool_call",
			"tool_result",
		]);
		expect(events[2].correlation?.toolCallId).toBe("call_1");
		expect(JSON.parse(events[2].payload.input as string)).toEqual({
			action: "left_click",
			coordinate: [10, 20],
			hasText: false,
		});
		expect(events[3].payload).toMatchObject({ ok: true });
		expect(events.every((event) => event.source.kind === "driver")).toBe(true);
		expect(events.map((event) => event.clientSequence)).toEqual([1, 2, 3, 4]);
	});

	it.each([
		"type",
		"key",
	])("redacts computer %s text before previewing without changing the tool input", async (action) => {
		const { recorder, events } = makeRecorder();
		const hooks = createTranscriptRecordingHooks(recorder, { kind: "driver" });
		const input = {
			action,
			text: "TOP_LEVEL_CREDENTIAL_SENTINEL",
			coordinate: [10, 20],
		};
		await hooks.onEvent?.({
			type: "message-added",
			snapshot,
			message: makeMessage("assistant", [
				{
					type: "tool-call",
					toolCallId: "call_type",
					toolName: "computer",
					input,
				},
			]),
		});

		expect(events).toHaveLength(1);
		expect(JSON.stringify(events)).not.toContain(
			"TOP_LEVEL_CREDENTIAL_SENTINEL",
		);
		expect(JSON.parse(events[0].payload.input as string)).toEqual({
			action,
			coordinate: [10, 20],
			hasText: true,
		});
		expect(events[0]).toMatchObject({
			clientSequence: 1,
			source: { kind: "driver" },
			correlation: { toolCallId: "call_type" },
		});
		expect(input).toEqual({
			action,
			text: "TOP_LEVEL_CREDENTIAL_SENTINEL",
			coordinate: [10, 20],
		});
	});

	it("redacts computer sequence-step text before previewing without changing the steps", async () => {
		const { recorder, events } = makeRecorder();
		const hooks = createTranscriptRecordingHooks(recorder, { kind: "driver" });
		const input = {
			action: "run_sequence",
			actions: [
				{ action: "left_click", coordinate: [10, 20] },
				{ action: "type", text: "SEQUENCE_CREDENTIAL_SENTINEL" },
			],
		};
		await hooks.onEvent?.({
			type: "message-added",
			snapshot,
			message: makeMessage("assistant", [
				{
					type: "tool-call",
					toolCallId: "call_sequence",
					toolName: "computer",
					input,
				},
			]),
		});

		expect(events).toHaveLength(1);
		expect(JSON.stringify(events)).not.toContain(
			"SEQUENCE_CREDENTIAL_SENTINEL",
		);
		expect(JSON.parse(events[0].payload.input as string)).toEqual({
			action: "run_sequence",
			hasText: false,
			actions: [
				{ action: "left_click", coordinate: [10, 20], hasText: false },
				{ action: "type", hasText: true },
			],
		});
		expect(events[0].correlation?.toolCallId).toBe("call_sequence");
		expect(input).toEqual({
			action: "run_sequence",
			actions: [
				{ action: "left_click", coordinate: [10, 20] },
				{ action: "type", text: "SEQUENCE_CREDENTIAL_SENTINEL" },
			],
		});
	});

	it("keeps reasoning and other tools' text input in transcript previews", async () => {
		const { recorder, events } = makeRecorder();
		const hooks = createTranscriptRecordingHooks(recorder, { kind: "driver" });
		await hooks.onEvent?.({
			type: "message-added",
			snapshot,
			message: makeMessage("assistant", [
				{ type: "reasoning", text: "Checking the current page before acting." },
				{
					type: "tool-call",
					toolCallId: "call_other",
					toolName: "other_tool",
					input: { text: "ordinary tool input" },
				},
			]),
		});

		expect(events.map((event) => event.payload)).toEqual([
			{ role: "reasoning", text: "Checking the current page before acting." },
			{
				role: "tool_call",
				toolName: "other_tool",
				input: JSON.stringify({ text: "ordinary tool input" }),
			},
		]);
		expect(events.map((event) => event.clientSequence)).toEqual([1, 2]);
	});

	it("keeps tool outputs (and their screenshots) out of the journal", async () => {
		const { recorder, events } = makeRecorder();
		const hooks = createTranscriptRecordingHooks(recorder, {
			kind: "driver",
		});
		await hooks.onEvent?.({
			type: "message-added",
			snapshot,
			message: makeMessage("tool", [
				{
					type: "tool-result",
					toolCallId: "call_2",
					toolName: "computer",
					output: [{ type: "image", data: "aaaa", mediaType: "image/png" }],
				},
			]),
		});
		expect(JSON.stringify(events[0].payload)).not.toContain("aaaa");
	});

	it("records run start and end as status changes", async () => {
		const { recorder, events } = makeRecorder();
		const hooks = createTranscriptRecordingHooks(recorder, {
			kind: "driver",
		});
		await hooks.beforeRun?.({ snapshot });
		await hooks.afterRun?.({
			snapshot,
			result: { status: "completed" } as AgentRunResult,
		});

		expect(events.map((event) => event.type)).toEqual([
			"session.status_changed",
			"session.status_changed",
		]);
		expect(events.map((event) => event.payload.status)).toEqual([
			"running",
			"completed",
		]);
	});
});
