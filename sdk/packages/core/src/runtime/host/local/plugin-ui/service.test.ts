import type { PluginUiActionReply, PluginUiInvokeResult } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	attach,
	createHarness,
	deferred,
	PLUGIN,
	readyState,
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

	it("initializes extensions before the first invoke and replies with the slot state and epoch", async () => {
		const harness = createHarness();
		const { epoch, onAction, initializeExtensions } = harness.start("s1", {
			onAction: () => {
				harness.service.record("s1", epoch, {
					plugin: PLUGIN,
					slot: SLOT,
					state: readyState("r1"),
				});
				return { outcome: "ok" };
			},
		});

		const result = await harness.invoke("s1", attach);

		expect(initializeExtensions).toHaveBeenCalledTimes(1);
		expect(onAction).toHaveBeenCalledWith(attach, {
			sessionId: "s1",
			viewer: { id: "local", surface: "desktop" },
			viewers: 1,
		});
		expect(result).toEqual({
			outcome: "ok",
			epoch,
			state: expect.objectContaining({
				sessionId: "s1",
				plugin: PLUGIN,
				epoch,
				seq: 1,
				state: expect.objectContaining({ revision: "r1" }),
			}),
		});
		expect(harness.emitted).toHaveLength(1);
	});

	it("maps the handler's verdict, keeping only known refusal reasons", async () => {
		const harness = createHarness();
		const replies: PluginUiActionReply[] = [
			undefined,
			{ outcome: "refused", reason: "stale" },
			{ outcome: "refused", reason: "bogus" } as never,
		];
		const { epoch } = harness.start("s1", {
			onAction: () => replies.shift(),
		});

		expect(await harness.invoke("s1", attach)).toEqual({
			outcome: "ok",
			epoch,
		});
		expect(await harness.invoke("s1", skip)).toEqual({
			outcome: "refused",
			reason: "stale",
			epoch,
		});
		expect(await harness.invoke("s1", skip)).toEqual({
			outcome: "refused",
			epoch,
		});
	});

	it("rejects a handler throw with a fixed outcome, never the plugin's text", async () => {
		const harness = createHarness();
		const { epoch } = harness.start("s1", {
			onAction: () => {
				throw new Error("secret prompt text");
			},
		});

		const result = await harness.invoke("s1", skip);

		expect(result).toEqual({ outcome: "rejected", epoch });
		expect(JSON.stringify(harness.capture.mock.calls)).not.toContain(
			"secret prompt text",
		);
	});

	it("puts the epoch on every reply for a resident session", async () => {
		const harness = createHarness();
		const { epoch } = harness.start("s1", {
			onAction: (action) =>
				action.verb === "skip"
					? { outcome: "refused", reason: "stale" }
					: action.verb === "use"
						? new Promise(() => {})
						: undefined,
		});
		const noOwner = harness.start("no-owner", { unhandled: true });
		const failing = harness.start("failing", {
			initializeExtensions: async () => {
				throw new Error("setup failed");
			},
		});

		const invalid = await harness.invoke("s1", { verb: "skip" });
		const refused = await harness.invoke("s1", skip);
		const pendingUse = harness.invoke("s1", {
			verb: "use",
			input: "key",
			revision: "r1",
			itemId: "fix",
		});
		await vi.advanceTimersByTimeAsync(10_000);
		const timedOut = await pendingUse;
		const missingOwner = await harness.invoke("no-owner", attach);
		const notInitialized = await harness.invoke("failing", attach);

		expect(invalid).toEqual({ outcome: "rejected", epoch });
		expect(refused).toEqual({ outcome: "refused", reason: "stale", epoch });
		expect(timedOut).toEqual({ outcome: "timeout", epoch });
		expect(missingOwner).toEqual({
			outcome: "unavailable",
			epoch: noOwner.epoch,
		});
		expect(notInitialized).toEqual({
			outcome: "unavailable",
			epoch: failing.epoch,
		});
		expect(failing.onAction).not.toHaveBeenCalled();
	});

	it("rate-limits invokes per session without calling the plugin", async () => {
		const harness = createHarness();
		const { epoch, onAction } = harness.start("s1");

		const results = await Promise.all(
			Array.from({ length: 21 }, () => harness.invoke("s1", skip)),
		);

		expect(results.slice(0, 20).every((r) => r.outcome === "ok")).toBe(true);
		expect(results[20]).toEqual({ outcome: "rejected", epoch });
		expect(onAction).toHaveBeenCalledTimes(20);

		await vi.advanceTimersByTimeAsync(100);
		expect((await harness.invoke("s1", skip)).outcome).toBe("ok");
	});

	it("answers unavailable for a slot outside the session's catalog without initializing anything", async () => {
		const harness = createHarness();
		const { epoch, onAction, initializeExtensions } = harness.start("s1", {
			slots: [],
		});

		const result = await harness.invoke("s1", attach);

		expect(result).toEqual({ outcome: "unavailable", epoch });
		expect(initializeExtensions).not.toHaveBeenCalled();
		expect(onAction).not.toHaveBeenCalled();
		expect(await harness.service.get({ sessionId: "s1" })).toEqual([]);
	});

	it("answers a session that is not resident with no epoch", async () => {
		const harness = createHarness();
		const epoch = harness.service.begin("booting", [SLOT]);
		harness.service.record("booting", epoch, {
			plugin: PLUGIN,
			slot: SLOT,
			state: readyState("r1"),
		});

		expect(await harness.invoke("booting", attach)).toEqual({
			outcome: "unavailable",
		});
		expect(await harness.invoke("missing", attach)).toEqual({
			outcome: "unavailable",
		});
		expect(await harness.service.get({ sessionId: "booting" })).toEqual([]);

		// Rejections before the residency check keep the held setup state back too.
		expect(await harness.invoke("booting", { verb: "skip" })).toEqual({
			outcome: "rejected",
		});
		const burst = await Promise.all(
			Array.from({ length: 21 }, () => harness.invoke("booting", attach)),
		);
		expect(burst.at(-1)).toEqual({ outcome: "rejected" });
		expect(harness.emitted).toEqual([]);
	});

	it("never throws on malformed input", async () => {
		const harness = createHarness();
		harness.start("s1");

		await expect(harness.service.invoke(undefined as never)).resolves.toEqual({
			outcome: "rejected",
		});
		await expect(
			harness.service.invoke({
				sessionId: "s1",
				slot: "unknown" as never,
				action: attach,
			}),
		).resolves.toMatchObject({ outcome: "rejected" });
		await expect(harness.service.get(undefined as never)).resolves.toEqual([]);
	});

	it("stamps the remembered surface on a viewer's later actions and counts viewers", async () => {
		const harness = createHarness();
		const { onAction } = harness.start("s1");
		const hubViewer = { id: "client-1", clientType: "desktop" };

		await harness.invoke("s1", attach, hubViewer, "conn-1");
		await harness.invoke("s1", { verb: "attach", surface: "cli" });
		await harness.invoke("s1", skip, hubViewer);
		await harness.invoke("s1", { verb: "detach" }, hubViewer);
		await harness.invoke("s1", { verb: "detach" }, hubViewer);

		expect(onAction.mock.calls.map(([, context]) => context)).toEqual([
			{
				sessionId: "s1",
				viewer: { ...hubViewer, surface: "desktop" },
				viewers: 1,
			},
			{ sessionId: "s1", viewer: { id: "local", surface: "cli" }, viewers: 2 },
			{
				sessionId: "s1",
				viewer: { ...hubViewer, surface: "desktop" },
				viewers: 2,
			},
			{
				sessionId: "s1",
				viewer: { ...hubViewer, surface: "desktop" },
				viewers: 1,
			},
			// A detach without a lease still reaches the plugin; only synthesized ones are dropped.
			{ sessionId: "s1", viewer: hubViewer, viewers: 1 },
		]);
	});

	it("bounds onAction by its own timer, even for a handler that would wait 60 s", async () => {
		// Subprocess mode (CLINE_PLUGIN_MODE=sandbox) never goes through the registry's
		// 10 s guard; its proxy call waits up to 60 s. Core's own bound still applies.
		const harness = createHarness();
		const { epoch } = harness.start("s1", {
			onAction: () =>
				new Promise((resolve) => setTimeout(() => resolve(undefined), 60_000)),
		});

		const pending = harness.invoke("s1", skip);
		let settled: PluginUiInvokeResult | undefined;
		void pending.then((result) => {
			settled = result;
		});
		await vi.advanceTimersByTimeAsync(9_999);
		expect(settled).toBeUndefined();
		await vi.advanceTimersByTimeAsync(1);
		expect(settled).toEqual({ outcome: "timeout", epoch });
	});

	it("times out an invoke queued behind a hanging handler 10 s after it arrived and never delivers it", async () => {
		const harness = createHarness();
		const { epoch, onAction } = harness.start("s1", {
			onAction: (action) =>
				action.verb === "use" ? new Promise(() => {}) : { outcome: "ok" },
		});

		const hanging = harness.invoke("s1", {
			verb: "use",
			input: "key",
			revision: "r1",
			itemId: "fix",
		});
		const queued = harness.invoke("s1", skip);
		await vi.advanceTimersByTimeAsync(10_000);

		expect(await queued).toEqual({ outcome: "timeout", epoch });
		expect(await hanging).toEqual({ outcome: "timeout", epoch });
		await vi.advanceTimersByTimeAsync(30_000);
		expect(onAction).toHaveBeenCalledTimes(1);

		// The chain moved on: the next invoke is served.
		expect(await harness.invoke("s1", skip)).toEqual({ outcome: "ok", epoch });
		expect(onAction).toHaveBeenCalledTimes(2);
	});

	it("times out at 10 s while initializeExtensions hangs", async () => {
		const harness = createHarness();
		const { epoch, onAction } = harness.start("s1", {
			initializeExtensions: () => new Promise(() => {}),
		});

		const pending = harness.invoke("s1", attach);
		await vi.advanceTimersByTimeAsync(10_000);

		expect(await pending).toEqual({ outcome: "timeout", epoch });
		expect(onAction).not.toHaveBeenCalled();
	});

	it("replies within 20 s when a queued invoke reaches a hanging handler just in time", async () => {
		const harness = createHarness();
		const first = deferred<PluginUiActionReply>();
		const { epoch } = harness.start("s1", {
			onAction: (action) =>
				action.verb === "use" ? first.promise : new Promise(() => {}),
		});

		void harness.invoke("s1", {
			verb: "use",
			input: "key",
			revision: "r1",
			itemId: "fix",
		});
		const second = harness.invoke("s1", skip);
		let settled: PluginUiInvokeResult | undefined;
		void second.then((result) => {
			settled = result;
		});
		await vi.advanceTimersByTimeAsync(9_900);
		first.resolve({ outcome: "ok" });
		await vi.advanceTimersByTimeAsync(9_999);
		expect(settled).toBeUndefined();
		await vi.advanceTimersByTimeAsync(1);
		expect(settled).toEqual({ outcome: "timeout", epoch });
		expect(Date.now() - 1_000_000).toBeLessThan(20_000);
	});
});
