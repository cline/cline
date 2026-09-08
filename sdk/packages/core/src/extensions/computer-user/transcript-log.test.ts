import type { AgentMessage } from "@cline/shared";
import { describe, expect, it } from "vitest";
import type {
	ArtifactSinkStatus,
	ComputerTaskArtifactEvent,
} from "../computer-observability/artifact-events";
import { ComputerTaskArtifactRecorder } from "../computer-observability/recorder";
import { createTranscriptRecordingHooks } from "../computer-observability/transcript-observer";
import { ComputerUserTranscriptLog } from "./transcript-log";

const snapshot = { agentId: "agent-1" } as never;

function makeMessage(
	role: AgentMessage["role"],
	content: AgentMessage["content"],
): AgentMessage {
	return { id: "msg_1", role, content, createdAt: 0 };
}

/**
 * Drives the real recording hooks with a recorder whose sink collects
 * journal events — the same path production uses — so the log's content is
 * proven identical to what the observatory would journal.
 */
function commitThroughHooks(
	log: ComputerUserTranscriptLog,
	messages: AgentMessage[],
): ComputerTaskArtifactEvent[] {
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
	const hooks = createTranscriptRecordingHooks(
		recorder,
		{ kind: "computer_user", sessionId: "helper-session" },
		(event) => log.append(event),
	);
	for (const message of messages) {
		void hooks.onEvent?.({ type: "message-added", snapshot, message });
	}
	return events;
}

describe("ComputerUserTranscriptLog", () => {
	it("records the same reduced entries the journal sink receives", () => {
		const log = new ComputerUserTranscriptLog();
		const events = commitThroughHooks(log, [
			makeMessage("user", [{ type: "text", text: "Open the settings page" }]),
			makeMessage("assistant", [
				{ type: "reasoning", text: "Find the window first." },
				{ type: "text", text: "Opening it now." },
				{
					type: "tool-call",
					toolCallId: "call_1",
					toolName: "computer",
					input: { action: "left_click", coordinate: [10, 20] },
				},
			]),
			makeMessage("tool", [
				{
					type: "tool-result",
					toolCallId: "call_1",
					toolName: "computer",
					output: "clicked",
				},
			]),
		]);

		const { entries, latestSeq } = log.tail({ limit: 100 });
		const journalTranscript = events
			.filter((event) => event.type === "transcript.message_committed")
			.map((event) => event.payload);
		expect(entries.map((entry) => entry.role)).toEqual(
			journalTranscript.map((payload) => payload.role),
		);
		expect(entries).toHaveLength(5);
		expect(entries[0]).toMatchObject({
			role: "user",
			text: "Open the settings page",
			sessionId: "helper-session",
		});
		expect(entries[1]).toMatchObject({ role: "reasoning" });
		expect(entries[2]).toMatchObject({
			role: "assistant",
			text: "Opening it now.",
		});
		expect(entries[3]).toMatchObject({
			role: "tool_call",
			toolName: "computer",
			toolCallId: "call_1",
		});
		expect(entries[3].input).toContain("left_click");
		expect(entries[4]).toMatchObject({
			role: "tool_result",
			toolName: "computer",
			ok: true,
		});
		expect(entries[0].seq).toBe(1);
		expect(latestSeq).toBe(entries[entries.length - 1].seq);
	});

	it("pages new activity with sinceSeq", () => {
		const log = new ComputerUserTranscriptLog();
		commitThroughHooks(log, [
			makeMessage("user", [{ type: "text", text: "first" }]),
			makeMessage("user", [{ type: "text", text: "second" }]),
		]);
		const first = log.tail({ limit: 100 });
		expect(first.entries.map((entry) => entry.text)).toEqual([
			"first",
			"second",
		]);

		commitThroughHooks(log, [
			makeMessage("user", [{ type: "text", text: "third" }]),
		]);
		const next = log.tail({ limit: 100, sinceSeq: first.latestSeq });
		expect(next.entries.map((entry) => entry.text)).toEqual(["third"]);
		expect(next.latestSeq).toBe(first.latestSeq + 1);
	});

	it("keeps only the last capacity entries", () => {
		const log = new ComputerUserTranscriptLog(3);
		commitThroughHooks(
			log,
			[1, 2, 3, 4, 5].map((n) =>
				makeMessage("user", [{ type: "text", text: `m${n}` }]),
			),
		);
		const { entries, latestSeq } = log.tail({ limit: 100 });
		expect(entries.map((entry) => entry.text)).toEqual(["m3", "m4", "m5"]);
		expect(entries[0].seq).toBe(3);
		expect(latestSeq).toBe(5);
	});

	it("ignores non-transcript events the tee may see", () => {
		const log = new ComputerUserTranscriptLog();
		log.append({
			version: 1,
			artifactId: "art_test",
			eventId: "evt_x",
			clientSequence: 1,
			occurredAt: new Date().toISOString(),
			source: { kind: "coordinator" },
			type: "session.status_changed",
			payload: { status: "running" },
		});
		expect(log.tail()).toMatchObject({ entries: [], latestSeq: 0 });
	});
});
