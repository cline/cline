import type { PluginUiActionReply } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	attach,
	createHarness,
	deferred,
	PLUGIN,
	SLOT,
	skip,
} from "./service.fixtures";

describe("PluginUiService", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("refuses queued ordinary invokes once closing, and waits at most closeWaitMs", async () => {
		const harness = createHarness();
		const { epoch, onAction } = harness.start("s1", {
			onAction: (action) =>
				action.verb === "use" ? new Promise(() => {}) : { outcome: "ok" },
		});

		void harness.invoke("s1", {
			verb: "use",
			input: "key",
			revision: "r1",
			itemId: "fix",
		});
		const queued = harness.invoke("s1", skip);
		await vi.advanceTimersByTimeAsync(0);
		let closed = false;
		const closing = harness.service.closeSession("s1", epoch).then(() => {
			closed = true;
		});

		expect(await harness.invoke("s1", skip)).toEqual({
			outcome: "unavailable",
		});
		expect(await queued).toEqual({ outcome: "unavailable" });
		await vi.advanceTimersByTimeAsync(1_999);
		expect(closed).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await closing;
		expect(closed).toBe(true);
		expect(harness.store.epoch("s1")).toBeUndefined();

		await vi.advanceTimersByTimeAsync(10_000);
		expect(onAction).toHaveBeenCalledTimes(1);
	});

	it("detaches every remaining viewer at close, counting down to 0, despite closing and an empty bucket", async () => {
		const harness = createHarness();
		const contexts: Array<{ verb: string; viewers: number; ended: boolean }> =
			[];
		const { epoch } = harness.start("s1", {
			onAction: (action, context) => {
				contexts.push({
					verb: action.verb,
					viewers: context.viewers,
					ended: harness.store.epoch("s1") === undefined,
				});
				return { outcome: "ok" };
			},
		});
		await harness.invoke("s1", attach, { id: "a" });
		await harness.invoke("s1", attach, { id: "b" });
		while ((await harness.invoke("s1", skip)).outcome !== "rejected") {}
		contexts.length = 0;

		await harness.service.closeSession("s1", epoch);

		expect(contexts).toEqual([
			{ verb: "detach", viewers: 1, ended: false },
			{ verb: "detach", viewers: 0, ended: false },
		]);
		expect(harness.store.epoch("s1")).toBeUndefined();
	});

	it("delivers one detach when a hub disconnect and a close both synthesize one", async () => {
		const harness = createHarness();
		const { epoch, onAction } = harness.start("s1");
		await harness.invoke("s1", attach, { id: "client" }, "conn-1");
		onAction.mockClear();

		harness.service.detachViewer("client", "conn-1");
		await harness.service.closeSession("s1", epoch);

		expect(onAction.mock.calls.map(([action]) => action.verb)).toEqual([
			"detach",
		]);
		expect(onAction.mock.calls[0]?.[1].viewers).toBe(0);
	});

	it("drops a late unregister's detach once the viewer re-attached on a new connection", async () => {
		const harness = createHarness();
		const slow = deferred<PluginUiActionReply>();
		const { onAction } = harness.start("s1", {
			onAction: (action) =>
				action.verb === "use" ? slow.promise : { outcome: "ok" },
		});
		const viewer = { id: "client" };
		await harness.invoke("s1", attach, viewer, "conn-old");

		const inFlight = harness.invoke("s1", {
			verb: "use",
			input: "key",
			revision: "r1",
			itemId: "fix",
		});
		const reattached = harness.invoke("s1", attach, viewer, "conn-new");
		// The old socket's unregister lands after the new socket queued its attach.
		harness.service.detachViewer("client", "conn-old");
		slow.resolve({ outcome: "ok" });
		await inFlight;
		await reattached;
		await vi.advanceTimersByTimeAsync(0);

		expect(onAction.mock.calls.map(([action]) => action.verb)).toEqual([
			"attach",
			"use",
			"attach",
		]);
		expect(harness.store.viewers("s1")).toEqual([
			{ id: "client", surface: "desktop" },
		]);

		// Without a re-attach, the old connection's unregister still detaches.
		harness.service.detachViewer("client", "conn-new");
		await vi.advanceTimersByTimeAsync(0);
		expect(onAction.mock.calls.at(-1)?.[0]).toEqual({ verb: "detach" });
		expect(harness.store.viewers("s1")).toEqual([]);
	});

	it("detaches a viewer whose attach was still queued behind another action when its connection closed", async () => {
		const harness = createHarness();
		const slow = deferred<PluginUiActionReply>();
		const { onAction } = harness.start("s1", {
			onAction: (action) =>
				action.verb === "use" ? slow.promise : { outcome: "ok" },
		});

		const inFlight = harness.invoke(
			"s1",
			{ verb: "use", input: "key", revision: "r1", itemId: "fix" },
			{ id: "other" },
			"conn-other",
		);
		const queuedAttach = harness.invoke(
			"s1",
			attach,
			{ id: "client" },
			"conn-1",
		);
		harness.service.detachViewer("client", "conn-1");
		slow.resolve({ outcome: "ok" });
		await inFlight;
		await queuedAttach;
		await vi.advanceTimersByTimeAsync(0);

		expect(onAction.mock.calls.map(([action]) => action.verb)).toEqual([
			"use",
			"attach",
			"detach",
		]);
		expect(onAction.mock.calls.at(-1)?.[1]).toEqual({
			sessionId: "s1",
			viewer: { id: "client", surface: "desktop" },
			viewers: 0,
		});
		expect(harness.store.viewers("s1")).toEqual([]);
	});

	it("detaches a viewer whose attach was still initializing extensions when its connection closed", async () => {
		const harness = createHarness();
		const initialized = deferred();
		const { onAction } = harness.start("s1", {
			initializeExtensions: () => initialized.promise,
		});

		const pendingAttach = harness.invoke(
			"s1",
			attach,
			{ id: "client" },
			"conn-1",
		);
		await vi.advanceTimersByTimeAsync(0);
		harness.service.detachViewer("client", "conn-1");
		initialized.resolve();
		await pendingAttach;
		await vi.advanceTimersByTimeAsync(0);

		expect(
			onAction.mock.calls.map(([action, context]) => [
				action.verb,
				context.viewers,
			]),
		).toEqual([
			["attach", 1],
			["detach", 0],
		]);
		expect(harness.store.viewers("s1")).toEqual([]);
	});

	it("tells the plugin nothing for a queued attach that timed out after its connection closed", async () => {
		const harness = createHarness();
		const { epoch, onAction } = harness.start("s1", {
			onAction: (action) =>
				action.verb === "use" ? new Promise(() => {}) : { outcome: "ok" },
		});

		void harness.invoke(
			"s1",
			{ verb: "use", input: "key", revision: "r1", itemId: "fix" },
			{ id: "other" },
			"conn-other",
		);
		const queuedAttach = harness.invoke(
			"s1",
			attach,
			{ id: "client" },
			"conn-1",
		);
		harness.service.detachViewer("client", "conn-1");
		await vi.advanceTimersByTimeAsync(10_000);

		expect(await queuedAttach).toEqual({ outcome: "timeout", epoch });
		await vi.advanceTimersByTimeAsync(30_000);
		expect(onAction.mock.calls.map(([action]) => action.verb)).toEqual(["use"]);
		expect(harness.store.viewers("s1")).toEqual([]);
	});

	it("answers unavailable after the epoch ended and holds no chain once released", async () => {
		const harness = createHarness();
		const { epoch, onAction } = harness.start("s1");
		await harness.service.closeSession("s1", epoch);

		// Still resident: the host deletes the session only after teardown.
		expect(await harness.invoke("s1", attach)).toEqual({
			outcome: "unavailable",
		});
		expect(onAction).not.toHaveBeenCalled();

		harness.sessions.delete("s1");
		harness.service.release("s1", epoch);
		expect(harness.chains.has("s1")).toBe(false);
		expect(await harness.invoke("s1", attach)).toEqual({
			outcome: "unavailable",
		});
	});

	it("ignores a close for an older epoch", async () => {
		const harness = createHarness();
		const old = harness.start("s1");
		const current = harness.start("s1");

		await harness.service.closeSession("s1", old.epoch);
		harness.service.release("s1", old.epoch);

		expect(await harness.invoke("s1", attach)).toEqual({
			outcome: "ok",
			epoch: current.epoch,
		});
	});

	/** Closes, deletes and releases the session the way the host's teardown does. */
	async function tearDown(
		harness: ReturnType<typeof createHarness>,
		sessionId: string,
		epoch: number,
	) {
		const closing = harness.service.closeSession(sessionId, epoch);
		await vi.advanceTimersByTimeAsync(2_000);
		await closing;
		harness.sessions.delete(sessionId);
		harness.service.release(sessionId, epoch);
	}

	it("drops teardown detaches still queued when the close's wait runs out", async () => {
		const harness = createHarness();
		const { epoch, onAction } = harness.start("s1", {
			onAction: (action) =>
				action.verb === "use"
					? new Promise((resolve) =>
							setTimeout(() => resolve(undefined), 3_000),
						)
					: { outcome: "ok" },
		});
		await harness.invoke("s1", attach);
		void harness.invoke("s1", {
			verb: "use",
			input: "key",
			revision: "r1",
			itemId: "fix",
		});
		await vi.advanceTimersByTimeAsync(0);

		await tearDown(harness, "s1", epoch);
		await vi.advanceTimersByTimeAsync(20_000);

		expect(onAction.mock.calls.map(([action]) => action.verb)).toEqual([
			"attach",
			"use",
		]);
	});

	it("keeps an old epoch's queued teardown detach out of a same-id restart", async () => {
		const harness = createHarness();
		const old = harness.start("s1", {
			onAction: (action) =>
				action.verb === "use" ? new Promise(() => {}) : { outcome: "ok" },
		});
		await harness.invoke("s1", attach, { id: "a" });
		void harness.invoke(
			"s1",
			{ verb: "use", input: "key", revision: "r1", itemId: "fix" },
			{ id: "a" },
		);
		await vi.advanceTimersByTimeAsync(0);
		await tearDown(harness, "s1", old.epoch);

		const restarted = harness.start("s1");
		expect(await harness.invoke("s1", attach, { id: "a" })).toEqual({
			outcome: "ok",
			epoch: restarted.epoch,
		});
		// The old `use` hits core's 10 s bound, which frees the old chain's queued detach.
		await vi.advanceTimersByTimeAsync(10_000);

		expect(old.onAction.mock.calls.map(([action]) => action.verb)).toEqual([
			"attach",
			"use",
		]);
		expect(restarted.onAction.mock.calls.map(([, context]) => context)).toEqual(
			[
				{
					sessionId: "s1",
					viewer: { id: "a", surface: "desktop" },
					viewers: 1,
				},
			],
		);
		expect(harness.store.viewers("s1")).toEqual([
			{ id: "a", surface: "desktop" },
		]);
	});

	it("drops an invoke still initializing when its session closes and restarts under the same id", async () => {
		const harness = createHarness();
		const initialized = deferred();
		const old = harness.start("s1", {
			plugin: "old-copy",
			initializeExtensions: () => initialized.promise,
		});
		const oldAttach = harness.invoke("s1", attach, { id: "old-viewer" });
		await vi.advanceTimersByTimeAsync(0);
		await tearDown(harness, "s1", old.epoch);
		const restarted = harness.start("s1");

		initialized.resolve();
		await vi.advanceTimersByTimeAsync(0);

		expect(await oldAttach).toEqual({ outcome: "unavailable" });
		expect(old.onAction).not.toHaveBeenCalled();
		expect(harness.store.viewers("s1")).toEqual([]);
		expect(harness.store.owner("s1", SLOT)).toBeUndefined();
		expect(await harness.invoke("s1", attach)).toEqual({
			outcome: "ok",
			epoch: restarted.epoch,
		});
		expect(harness.store.owner("s1", SLOT)).toBe(PLUGIN);
	});
});
