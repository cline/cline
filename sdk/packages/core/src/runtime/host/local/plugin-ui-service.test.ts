import type {
	AgentExtensionUiSlot,
	ComposerSuggestionsState,
	ITelemetryService,
	PluginUiAction,
	PluginUiActionContext,
	PluginUiActionReply,
	PluginUiInvokeResult,
	PluginUiStateEnvelope,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_TELEMETRY_EVENTS } from "../../../services/telemetry/core-events";
import { PluginUiService, type PluginUiSession } from "./plugin-ui-service";
import type { PluginUiStore } from "./plugin-ui-store";

const SLOT = "composer.suggestions";
const PLUGIN = "next-turn";

type OnAction = (
	action: PluginUiAction,
	context: PluginUiActionContext,
) => PluginUiActionReply | Promise<PluginUiActionReply>;

function readyState(revision: string): ComposerSuggestionsState {
	return {
		status: "ready",
		title: "Next",
		revision,
		canRefresh: false,
		items: [
			{
				id: "fix",
				label: "Fix",
				tone: "repair",
				prompt: "Fix the failing test",
				sendable: true,
			},
		],
	};
}

function deferred<T = void>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function createHarness() {
	const sessions = new Map<string, PluginUiSession>();
	const emitted: PluginUiStateEnvelope[] = [];
	const capture = vi.fn();
	const telemetry = { capture } as unknown as ITelemetryService;
	const service = new PluginUiService({
		sessions: (sessionId) => sessions.get(sessionId),
		emit: (envelope) => emitted.push(envelope),
		telemetry,
	});

	function start(
		sessionId: string,
		options: {
			onAction?: OnAction;
			plugin?: string;
			/** A session whose plugins registered no handler for the slot. */
			unhandled?: boolean;
			slots?: Array<typeof SLOT>;
			initializeExtensions?: () => Promise<void>;
		} = {},
	) {
		const onAction = vi.fn<OnAction>(
			options.onAction ?? (() => ({ outcome: "ok" })),
		);
		const handler: AgentExtensionUiSlot & { plugin: string } = {
			slot: SLOT,
			plugin: options.plugin ?? PLUGIN,
			onAction: (action, context) => onAction(action, context),
		};
		const initializeExtensions = vi.fn(
			options.initializeExtensions ?? (async () => {}),
		);
		const session = {
			agent: {
				initializeExtensions,
				getExtensionRegistry: () => ({
					uiSlots: options.unhandled ? [] : [handler],
				}),
			},
			config: {},
		} as unknown as PluginUiSession;
		const epoch = service.begin(sessionId, options.slots ?? [SLOT]);
		sessions.set(sessionId, session);
		service.activate(sessionId, epoch);
		return { epoch, onAction, initializeExtensions };
	}

	function invoke(
		sessionId: string,
		action: unknown,
		viewer?: { id: string; clientType?: string },
		connectionId?: string,
	): Promise<PluginUiInvokeResult> {
		return service.invoke(
			{ sessionId, slot: SLOT, action: action as PluginUiAction },
			viewer,
			connectionId,
		);
	}

	function events(name: string) {
		return capture.mock.calls
			.map(([input]) => input as { event: string; properties: unknown })
			.filter((input) => input.event === name)
			.map((input) => input.properties);
	}

	// The service's private state, for asserting what teardown leaves behind.
	const store = Reflect.get(service, "store") as PluginUiStore;
	const chains = Reflect.get(service, "chains") as Map<string, unknown>;

	return {
		service,
		store,
		chains,
		sessions,
		emitted,
		capture,
		start,
		invoke,
		events,
	};
}

const attach = { verb: "attach", surface: "desktop" } as const;
const skip = {
	verb: "skip",
	input: "key",
	revision: "r1",
	itemId: "fix",
} as const;

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

	it("never throws when the telemetry sink does, and still tells the plugin", async () => {
		const harness = createHarness();
		harness.capture.mockImplementation(() => {
			throw new Error("telemetry down");
		});
		const { epoch, onAction } = harness.start("s1");

		await expect(harness.invoke("s1", attach)).resolves.toEqual({
			outcome: "ok",
			epoch,
		});
		await expect(harness.invoke("s1", skip)).resolves.toEqual({
			outcome: "ok",
			epoch,
		});
		await expect(
			harness.service.closeSession("s1", epoch),
		).resolves.toBeUndefined();

		expect(
			onAction.mock.calls.map(([action, context]) => [
				action.verb,
				context.viewers,
			]),
		).toEqual([
			["attach", 1],
			["skip", 1],
			["detach", 0],
		]);
	});

	it("sends invoke telemetry only for gestures and one summary per session at close", async () => {
		const harness = createHarness();
		const { epoch } = harness.start("s1", {
			onAction: () => {
				harness.service.record("s1", epoch, {
					plugin: PLUGIN,
					slot: SLOT,
					state: readyState("r1"),
				});
			},
		});

		await harness.invoke("s1", attach, { id: "a" });
		await harness.invoke("s1", { verb: "attach", surface: "cli" }, { id: "b" });
		await harness.invoke(
			"s1",
			{ verb: "exposed", revision: "r1", itemIds: ["fix"] },
			{ id: "a" },
		);
		await harness.invoke(
			"s1",
			{ verb: "signal", name: "key_inert", reason: "not_exposed" },
			{ id: "a" },
		);
		await harness.invoke("s1", skip, { id: "a" });
		await harness.invoke("s1", { verb: "detach" }, { id: "b" });
		await harness.service.closeSession("s1", epoch);

		expect(harness.events(CORE_TELEMETRY_EVENTS.PLUGIN_UI.INVOKE)).toEqual([
			{
				plugin_name: PLUGIN,
				slot: SLOT,
				verb: "skip",
				outcome: "ok",
				latency_ms: 0,
				surface: "desktop",
			},
		]);
		expect(
			harness.events(CORE_TELEMETRY_EVENTS.PLUGIN_UI.SESSION_SUMMARY),
		).toEqual([
			{
				plugin_name: PLUGIN,
				slot: SLOT,
				attaches: 2,
				detaches: 2,
				exposed: 1,
				key_inert: 1,
				peak_viewers: 2,
				surfaces: ["cli", "desktop"],
			},
		]);
		expect(
			harness.events(CORE_TELEMETRY_EVENTS.PLUGIN_UI.VIEWERS_CHANGED),
		).toEqual([
			{ slot: SLOT, count: 1, surface: "desktop" },
			{ slot: SLOT, count: 0, surface: "desktop" },
		]);
	});

	it("reports dropped state at most once per session, plugin and reason a minute", async () => {
		const harness = createHarness();
		const { epoch } = harness.start("s1");
		const bigint = { plugin: PLUGIN, slot: SLOT, state: { n: BigInt(1) } };

		harness.service.record("s1", epoch, bigint);
		harness.service.record("s1", epoch, bigint);
		harness.service.record("s1", epoch, { ...bigint, state: { status: 1 } });
		await vi.advanceTimersByTimeAsync(60_000);
		harness.service.record("s1", epoch, bigint);

		expect(
			harness.events(CORE_TELEMETRY_EVENTS.PLUGIN_UI.STATE_DROPPED),
		).toEqual([
			{ plugin_name: PLUGIN, slot: SLOT, reason: "unserializable" },
			{ plugin_name: PLUGIN, slot: SLOT, reason: "invalid" },
			{ plugin_name: PLUGIN, slot: SLOT, reason: "unserializable" },
		]);
	});
});
