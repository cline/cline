import { describe, expect, it } from "vitest";
import { enqueueThreadTurn } from "./chat-runtime";
import { resolveThreadTurnQueueKey } from "./thread-bindings";

describe("resolveThreadTurnQueueKey", () => {
	it("gives every channel thread its own key", () => {
		// Channel threads each own a binding and a session, so they run in parallel.
		const first = resolveThreadTurnQueueKey({
			id: "slack:C1:1111.1",
			channelId: "slack:C1",
			isDM: false,
		});
		const second = resolveThreadTurnQueueKey({
			id: "slack:C1:2222.2",
			channelId: "slack:C1",
			isDM: false,
		});

		expect(first).not.toBe(second);
		expect(first).toBe("slack:C1:1111.1");
	});

	it("collapses every message in one DM onto a single key", () => {
		// findBindingForThread reuses one binding for a whole DM channel, so those
		// messages share a session and must not run concurrently.
		const first = resolveThreadTurnQueueKey({
			id: "slack:D1:1111.1",
			channelId: "slack:D1",
			isDM: true,
		});
		const second = resolveThreadTurnQueueKey({
			id: "slack:D1:2222.2",
			channelId: "slack:D1",
			isDM: true,
		});

		expect(first).toBe(second);
	});

	it("keeps separate DM channels separate", () => {
		expect(
			resolveThreadTurnQueueKey({
				id: "slack:D1:1111.1",
				channelId: "slack:D1",
				isDM: true,
			}),
		).not.toBe(
			resolveThreadTurnQueueKey({
				id: "slack:D2:1111.1",
				channelId: "slack:D2",
				isDM: true,
			}),
		);
	});
});

describe("thread turn scheduling", () => {
	function deferred() {
		let resolve!: () => void;
		const promise = new Promise<void>((r) => {
			resolve = r;
		});
		return { promise, resolve };
	}

	it("runs two messages in the same DM one after the other", async () => {
		const queues = new Map<string, Promise<void>>();
		const dm = { id: "slack:D1:1.1", channelId: "slack:D1", isDM: true };
		const later = { id: "slack:D1:2.2", channelId: "slack:D1", isDM: true };
		const order: string[] = [];
		const first = deferred();

		const firstTurn = enqueueThreadTurn(
			queues,
			resolveThreadTurnQueueKey(dm),
			async () => {
				order.push("first:start");
				await first.promise;
				order.push("first:end");
			},
		);
		const secondTurn = enqueueThreadTurn(
			queues,
			resolveThreadTurnQueueKey(later),
			async () => {
				order.push("second:start");
			},
		);

		// The second message must not touch the shared session until the first
		// message's run has finished.
		await new Promise((resolve) => setImmediate(resolve));
		expect(order).toEqual(["first:start"]);

		first.resolve();
		await Promise.all([firstTurn, secondTurn]);
		expect(order).toEqual(["first:start", "first:end", "second:start"]);
	});

	it("runs two channel threads at the same time", async () => {
		const queues = new Map<string, Promise<void>>();
		const threadA = { id: "slack:C1:1.1", channelId: "slack:C1", isDM: false };
		const threadB = { id: "slack:C1:2.2", channelId: "slack:C1", isDM: false };
		const order: string[] = [];
		const blocked = deferred();

		const turnA = enqueueThreadTurn(
			queues,
			resolveThreadTurnQueueKey(threadA),
			async () => {
				order.push("a:start");
				await blocked.promise;
				order.push("a:end");
			},
		);
		const turnB = enqueueThreadTurn(
			queues,
			resolveThreadTurnQueueKey(threadB),
			async () => {
				order.push("b:start");
			},
		);

		// B answers while A is still working: separate threads, separate sessions.
		await new Promise((resolve) => setImmediate(resolve));
		expect(order).toEqual(["a:start", "b:start"]);

		blocked.resolve();
		await Promise.all([turnA, turnB]);
		expect(order).toEqual(["a:start", "b:start", "a:end"]);
	});
});
