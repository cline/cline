import { describe, expect, it } from "vitest";
import { type SentTurnPayload, TurnPayloadTracker } from "./turn-payloads";

function payload(prompt: string, files: File[] = []): SentTurnPayload {
	return { prompt, attachedFiles: files };
}

function textFile(name: string): File {
	return new File(["content"], name, { type: "text/plain" });
}

describe("TurnPayloadTracker", () => {
	it("marks a direct turn's payload failed when the turn fails", () => {
		const tracker = new TurnPayloadTracker();
		const direct = payload("hello");
		tracker.beginDirectTurn(direct);
		tracker.failActiveTurn(1);
		expect(tracker.failedPayload).toBe(direct);
	});

	it("pairs a queued submission with its turn by server prompt id", () => {
		const tracker = new TurnPayloadTracker();
		const queued = payload("queued prompt", [textFile("a.txt")]);
		tracker.enqueue(queued);
		tracker.resolveQueuedPromptId(queued, "pending_1", 1);
		tracker.startTurn("pending_1", "queued prompt", 2);
		tracker.failActiveTurn(2);
		expect(tracker.failedPayload).toBe(queued);
	});

	it("keeps a re-routed direct dispatch active when its queued start arrives", () => {
		const tracker = new TurnPayloadTracker();
		const direct = payload("rerouted");
		tracker.beginDirectTurn(direct);
		// The runtime queued the prompt instead of running it directly; the
		// client has no entry for the id but the event prompt matches.
		tracker.startTurn("pending_9", "rerouted", 2);
		tracker.failActiveTurn(2);
		expect(tracker.failedPayload).toBe(direct);
	});

	it("completes the pairing when the start event beats the enqueue RPC", () => {
		const tracker = new TurnPayloadTracker();
		const queued = payload("fast start", [textFile("a.txt")]);
		tracker.enqueue(queued);
		// Turn starts before the enqueue RPC resolves with the id.
		tracker.startTurn("pending_1", "fast start", 2);
		tracker.resolveQueuedPromptId(queued, "pending_1", 2);
		tracker.failActiveTurn(2);
		expect(tracker.failedPayload).toBe(queued);
	});

	it("recovers the payload when the turn fails before the enqueue RPC resolves", () => {
		const tracker = new TurnPayloadTracker();
		const queued = payload("fast fail", [textFile("a.txt")]);
		tracker.enqueue(queued);
		tracker.startTurn("pending_1", "fast fail", 2);
		tracker.failActiveTurn(2);
		expect(tracker.failedPayload).toBeNull();
		// The late-resolving id still binds the payload to the failed turn.
		tracker.resolveQueuedPromptId(queued, "pending_1", 2);
		expect(tracker.failedPayload).toBe(queued);
	});

	it("does not promote a late-resolving id once a newer turn started", () => {
		const tracker = new TurnPayloadTracker();
		const queued = payload("stale");
		tracker.enqueue(queued);
		tracker.startTurn("pending_1", "stale", 2);
		// A newer turn began (epoch advanced) before the RPC resolved.
		tracker.resolveQueuedPromptId(queued, "pending_1", 3);
		tracker.failActiveTurn(3);
		expect(tracker.failedPayload).toBeNull();
	});

	it("merges same-text submissions to one id and keeps the newest inputs", () => {
		const tracker = new TurnPayloadTracker();
		const first = payload("dup", [textFile("first.txt")]);
		const second = payload("dup", [textFile("second.txt")]);
		tracker.enqueue(first);
		tracker.resolveQueuedPromptId(first, "pending_1", 1);
		tracker.enqueue(second);
		tracker.resolveQueuedPromptId(second, "pending_1", 1);
		tracker.startTurn("pending_1", "dup", 2);
		tracker.failActiveTurn(2);
		expect(tracker.failedPayload?.attachedFiles[0]?.name).toBe("second.txt");
	});

	it("inherits the earlier submission's attachments when the merge carries none", () => {
		const tracker = new TurnPayloadTracker();
		const first = payload("dup", [textFile("first.txt")]);
		const second = payload("dup");
		tracker.enqueue(first);
		tracker.resolveQueuedPromptId(first, "pending_1", 1);
		tracker.enqueue(second);
		tracker.resolveQueuedPromptId(second, "pending_1", 1);
		tracker.startTurn("pending_1", "dup", 2);
		tracker.failActiveTurn(2);
		expect(tracker.failedPayload?.attachedFiles[0]?.name).toBe("first.txt");
	});

	it("keeps a queued payload's attachments across an in-queue text edit", () => {
		const tracker = new TurnPayloadTracker();
		const queued = payload("original", [textFile("kept.txt")]);
		tracker.enqueue(queued);
		tracker.resolveQueuedPromptId(queued, "pending_1", 1);
		tracker.updateQueuedPrompt("pending_1", "edited");
		tracker.startTurn("pending_1", "edited", 2);
		tracker.failActiveTurn(2);
		expect(tracker.failedPayload?.prompt).toBe("edited");
		expect(tracker.failedPayload?.attachedFiles[0]?.name).toBe("kept.txt");
	});

	it("drops a removed queued prompt's payload", () => {
		const tracker = new TurnPayloadTracker();
		const queued = payload("removed");
		tracker.enqueue(queued);
		tracker.resolveQueuedPromptId(queued, "pending_1", 1);
		tracker.removeQueuedPrompt("pending_1");
		tracker.startTurn("pending_1", "removed", 2);
		tracker.failActiveTurn(2);
		expect(tracker.failedPayload).toBeNull();
	});

	it("stops tracking a submission that failed at dispatch", () => {
		const tracker = new TurnPayloadTracker();
		const queued = payload("dispatch failed");
		tracker.enqueue(queued);
		tracker.markFailed(queued);
		expect(tracker.failedPayload).toBe(queued);
		// The enqueue RPC settling afterwards must not resurrect the entry.
		tracker.resolveQueuedPromptId(queued, "pending_1", 1);
		tracker.startTurn("pending_1", "dispatch failed", 2);
		expect(tracker.failedPayload).toBeNull();
	});

	it("clears the previous failure when any new turn starts", () => {
		const tracker = new TurnPayloadTracker();
		tracker.beginDirectTurn(payload("first"));
		tracker.failActiveTurn(1);
		expect(tracker.failedPayload).not.toBeNull();
		tracker.startTurn("pending_2", "unrelated", 2);
		expect(tracker.failedPayload).toBeNull();
	});

	it("resets all state", () => {
		const tracker = new TurnPayloadTracker();
		tracker.beginDirectTurn(payload("direct"));
		tracker.failActiveTurn(1);
		tracker.enqueue(payload("queued"));
		tracker.reset();
		expect(tracker.failedPayload).toBeNull();
		tracker.startTurn("pending_1", "queued", 2);
		tracker.failActiveTurn(2);
		expect(tracker.failedPayload).toBeNull();
	});

	it("bounds the number of retained queued payloads", () => {
		const tracker = new TurnPayloadTracker();
		const first = payload("prompt 0");
		tracker.enqueue(first);
		tracker.resolveQueuedPromptId(first, "pending_0", 1);
		for (let i = 1; i <= 25; i++) {
			tracker.enqueue(payload(`prompt ${i}`));
		}
		// The oldest entry was evicted, so its turn cannot recover a payload.
		tracker.startTurn("pending_0", "prompt 0", 2);
		tracker.failActiveTurn(2);
		expect(tracker.failedPayload).toBeNull();
	});
});
