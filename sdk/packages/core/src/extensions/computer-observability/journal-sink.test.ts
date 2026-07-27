import { describe, expect, it } from "vitest";
import type { ComputerUseResponse } from "../computer-use/protocol";
import type { ComputerTaskArtifactEvent } from "./artifact-events";
import { createJournalEventSink } from "./journal-sink";

function makeEvent(clientSequence: number): ComputerTaskArtifactEvent {
	return {
		version: 1,
		artifactId: "art_test",
		eventId: `evt_${clientSequence}`,
		clientSequence,
		occurredAt: new Date(0).toISOString(),
		source: { kind: "driver" },
		type: "transcript.message_committed",
		payload: { n: clientSequence },
	};
}

describe("createJournalEventSink", () => {
	it("publishes events in emission order and reports completeness", async () => {
		const sent: Array<{ kind: string; payload: unknown }> = [];
		const sink = createJournalEventSink({
			send: async (request) => {
				sent.push({ kind: request.kind, payload: request.payload });
				return { id: 1, ok: true } satisfies ComputerUseResponse;
			},
		});

		sink.emit(makeEvent(1));
		sink.emit(makeEvent(2));
		const status = await sink.flush();

		expect(sent.map((request) => request.kind)).toEqual([
			"transcript.message_committed",
			"transcript.message_committed",
		]);
		expect(
			sent.map(
				(request) =>
					(request.payload as ComputerTaskArtifactEvent).clientSequence,
			),
		).toEqual([1, 2]);
		expect(status).toEqual({
			status: "complete",
			lastClientSequence: 2,
			lastAcknowledgedSequence: 2,
		});
	});

	it("degrades permanently when a send fails, without throwing at emit", async () => {
		let calls = 0;
		const sink = createJournalEventSink({
			send: async () => {
				calls += 1;
				if (calls === 1) {
					throw new Error("backend gone");
				}
				return { id: calls, ok: true } satisfies ComputerUseResponse;
			},
		});

		sink.emit(makeEvent(1));
		sink.emit(makeEvent(2));
		const status = await sink.flush();

		expect(status.status).toBe("degraded");
		expect(status.lastClientSequence).toBe(2);
		expect(status.lastAcknowledgedSequence).toBe(2);
	});

	it("treats a not-ok response as degradation", async () => {
		const sink = createJournalEventSink({
			send: async () => ({ id: 1, ok: false, error: "rejected" }),
		});
		sink.emit(makeEvent(1));
		const status = await sink.flush();
		expect(status.status).toBe("degraded");
		expect(status.lastAcknowledgedSequence).toBe(0);
	});
});
