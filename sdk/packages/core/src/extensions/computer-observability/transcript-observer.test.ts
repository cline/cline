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
		expect(events[2].payload.input).toContain("left_click");
		expect(events[3].payload).toMatchObject({ ok: true });
		expect(events.every((event) => event.source.kind === "driver")).toBe(true);
	});

	it("keeps tool outputs (and their screenshots) out of the journal", async () => {
		const { recorder, events } = makeRecorder();
		const hooks = createTranscriptRecordingHooks(recorder, {
			kind: "computer_user",
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
			kind: "computer_user",
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

