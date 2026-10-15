import type {
	ComposerSuggestionsState,
	PluginUiStateEnvelope,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type PluginUiStateDrop, PluginUiStore } from "./plugin-ui-store";

const SLOT = "composer.suggestions";

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
				prompt: `Fix it (${revision})`,
				sendable: true,
			},
		],
	};
}

function push(revision: string, plugin = "next-turn") {
	return { plugin, slot: SLOT, state: readyState(revision) };
}

function createStore() {
	const emitted: PluginUiStateEnvelope[] = [];
	const drops: PluginUiStateDrop[] = [];
	const store = new PluginUiStore({
		emit: (envelope) => emitted.push(envelope),
		onDrop: (drop) => drops.push(drop),
	});
	return { store, emitted, drops };
}

function revisions(envelopes: PluginUiStateEnvelope[]): Array<string | null> {
	return envelopes.map((envelope) => envelope.state?.revision ?? null);
}

describe("PluginUiStore", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("stamps each stored state with the session epoch and a seq per slot", () => {
		const { store, emitted } = createStore();
		const epoch = store.begin("s1", [SLOT]);
		store.activate("s1", epoch);

		store.record("s1", epoch, push("r1"));
		vi.advanceTimersByTime(100);
		store.record("s1", epoch, push("r2"));

		expect(epoch).toBe(1_000_000);
		expect(emitted.map(({ epoch, seq }) => ({ epoch, seq }))).toEqual([
			{ epoch, seq: 1 },
			{ epoch, seq: 2 },
		]);
		expect(emitted[1]).toMatchObject({
			sessionId: "s1",
			slot: SLOT,
			plugin: "next-turn",
		});
	});

	it("coalesces pushes inside 100 ms into one trailing state, last write wins", () => {
		const { store, emitted } = createStore();
		const epoch = store.begin("s1", [SLOT]);
		store.activate("s1", epoch);

		store.record("s1", epoch, push("r1"));
		store.record("s1", epoch, push("r2"));
		store.record("s1", epoch, push("r3"));
		expect(revisions(emitted)).toEqual(["r1"]);

		vi.advanceTimersByTime(99);
		expect(revisions(emitted)).toEqual(["r1"]);
		vi.advanceTimersByTime(1);
		expect(revisions(emitted)).toEqual(["r1", "r3"]);
		expect(emitted[1]?.seq).toBe(2);
	});

	it("flushes a pending push for get and current", () => {
		const { store, emitted } = createStore();
		const epoch = store.begin("s1", [SLOT]);
		store.activate("s1", epoch);
		store.record("s1", epoch, push("r1"));
		store.record("s1", epoch, push("r2"));

		expect(store.current("s1", SLOT)?.state?.revision).toBe("r2");
		expect(revisions(store.get("s1"))).toEqual(["r2"]);
		expect(revisions(emitted)).toEqual(["r1", "r2"]);
		vi.advanceTimersByTime(200);
		expect(emitted).toHaveLength(2);
	});

	it("drops a state identical to the last one without bumping seq", () => {
		const { store, emitted } = createStore();
		const epoch = store.begin("s1", [SLOT]);
		store.activate("s1", epoch);
		store.record("s1", epoch, push("r1"));

		// A pending change followed by the stored value again: the stored value is the latest.
		store.record("s1", epoch, push("r2"));
		store.record("s1", epoch, push("r1"));
		vi.advanceTimersByTime(100);
		store.record("s1", epoch, push("r1"));
		vi.advanceTimersByTime(100);

		expect(revisions(emitted)).toEqual(["r1"]);
		expect(store.current("s1", SLOT)?.seq).toBe(1);
	});

	it("drops pushes that fail normalization with the normalizer's reason", () => {
		const { store, emitted, drops } = createStore();
		const epoch = store.begin("s1", [SLOT]);
		store.activate("s1", epoch);

		store.record("s1", epoch, {
			plugin: "p",
			slot: SLOT,
			state: { big: BigInt(1) },
		});
		store.record("s1", epoch, { plugin: "p", slot: "elsewhere", state: {} });
		store.record("s1", epoch, {
			plugin: "p",
			slot: SLOT,
			state: { status: "ready" },
		});

		expect(drops.map((drop) => drop.reason)).toEqual([
			"unserializable",
			"unknown_slot",
			"invalid",
		]);
		expect(emitted).toEqual([]);
	});

	it("stores writes made before the session is resident and emits them once at activation", () => {
		const { store, emitted } = createStore();
		const epoch = store.begin("s1", [SLOT]);

		store.record("s1", epoch, push("r1"));
		store.record("s1", epoch, push("r2"));
		expect(vi.getTimerCount()).toBe(0);
		expect(emitted).toEqual([]);
		expect(store.current("s1", SLOT)).toMatchObject({ seq: 2 });

		store.activate("s1", epoch + 1);
		expect(emitted).toEqual([]);

		store.activate("s1", epoch);
		store.activate("s1", epoch);
		expect(revisions(emitted)).toEqual(["r2"]);
		expect(emitted[0]?.seq).toBe(2);

		vi.advanceTimersByTime(100);
		store.record("s1", epoch, push("r3"));
		store.record("s1", epoch, push("r4"));
		expect(revisions(emitted)).toEqual(["r2", "r3"]);
		vi.advanceTimersByTime(100);
		expect(revisions(emitted)).toEqual(["r2", "r3", "r4"]);
	});

	it("emits a tombstone cleared before activation once, at activation", () => {
		const { store, emitted } = createStore();
		const epoch = store.begin("s1", [SLOT]);
		store.record("s1", epoch, push("r1", "failing"));
		store.clearPlugin("s1", "failing");

		expect(emitted).toEqual([]);
		store.activate("s1", epoch);
		expect(emitted).toEqual([
			expect.objectContaining({ plugin: "failing", seq: 2, state: null }),
		]);
	});

	it("drops pushes from another epoch as stale", () => {
		const { store, emitted, drops } = createStore();
		const oldEpoch = store.begin("s1", [SLOT]);
		const epoch = store.begin("s1", [SLOT]);
		store.activate("s1", epoch);

		store.record("s1", oldEpoch, push("old"));
		store.record("unknown", epoch, push("r1"));

		expect(drops).toEqual([
			{
				sessionId: "s1",
				plugin: "next-turn",
				slot: SLOT,
				reason: "stale_epoch",
			},
			{
				sessionId: "unknown",
				plugin: "next-turn",
				slot: SLOT,
				reason: "stale_epoch",
			},
		]);
		expect(emitted).toEqual([]);
	});

	it("gives the slot to its first claimant and reports another plugin once", () => {
		const { store, emitted, drops } = createStore();
		const epoch = store.begin("s1", [SLOT]);
		store.activate("s1", epoch);

		store.record("s1", epoch, push("r1", "first"));
		store.record("s1", epoch, push("r2", "second"));
		store.record("s1", epoch, push("r3", "second"));

		expect(store.owner("s1", SLOT)).toBe("first");
		expect(store.claim("s1", SLOT, "second")).toBe(false);
		expect(store.claim("s1", SLOT, "first")).toBe(true);
		expect(drops.map((drop) => [drop.plugin, drop.reason])).toEqual([
			["second", "not_owner"],
		]);
		expect(revisions(emitted)).toEqual(["r1"]);
	});

	it("lets an invoke claim an unowned slot before any push", () => {
		const { store } = createStore();
		const epoch = store.begin("s1", [SLOT]);
		store.activate("s1", epoch);

		expect(store.claim("s1", SLOT, "handler")).toBe(true);
		store.record("s1", epoch, push("r1", "other"));
		expect(store.current("s1", SLOT)).toBeUndefined();
		expect(store.owner("s1", SLOT)).toBe("handler");
	});

	it("tombstones only the slots of the cleared plugin", () => {
		const { store, emitted } = createStore();
		const epoch = store.begin("s1", [SLOT]);
		store.activate("s1", epoch);
		store.record("s1", epoch, push("r1", "next-turn"));

		store.clearPlugin("s1", "someone-else");
		expect(emitted).toHaveLength(1);

		store.clearPlugin("s1", "next-turn");
		store.clearPlugin("s1", "next-turn");
		expect(emitted).toHaveLength(2);
		expect(emitted[1]).toMatchObject({ seq: 2, state: null });
		expect(store.get("s1")).toEqual([emitted[1]]);
	});

	it("counts viewers per session, one lease per viewer id", () => {
		const { store } = createStore();
		store.begin("s1", [SLOT]);

		expect(store.attachViewer("s1", { id: "a", surface: "cli" })).toBe(1);
		expect(store.attachViewer("s1", { id: "b", surface: "desktop" })).toBe(2);
		expect(store.attachViewer("s1", { id: "a", surface: "vscode" })).toBe(2);
		expect(store.viewer("s1", "a")?.surface).toBe("vscode");
		expect(store.detachViewer("s1", "a")).toBe(1);
		expect(store.detachViewer("s1", "a")).toBeUndefined();
		expect(store.viewers("s1")).toEqual([{ id: "b", surface: "desktop" }]);
		expect(store.attachViewer("missing", { id: "a" })).toBe(0);
	});

	it("scopes leases to the connection that attached them", () => {
		const { store } = createStore();
		store.begin("s1", [SLOT]);
		store.begin("s2", [SLOT]);
		store.attachViewer("s1", { id: "client" }, "conn-old");
		store.attachViewer("s2", { id: "client" }, "conn-old");

		// A re-attach on a new socket moves the lease to that connection.
		store.attachViewer("s1", { id: "client" }, "conn-new");

		expect(store.sessionsViewedBy("client", "conn-old")).toEqual(["s2"]);
		expect(store.sessionsViewedBy("client", "conn-new")).toEqual(["s1"]);
		expect(store.sessionsViewedBy("client")).toEqual(["s1", "s2"]);
		expect(store.detachViewer("s1", "client", "conn-old")).toBeUndefined();
		expect(store.viewers("s1")).toHaveLength(1);
		expect(store.detachViewer("s1", "client", "conn-new")).toBe(0);
		expect(store.detachViewer("s2", "client")).toBe(0);
	});

	it("records the catalog of each epoch", () => {
		const { store } = createStore();
		expect(store.slots("s1")).toEqual([]);

		store.begin("s1", [SLOT]);
		expect(store.slots("s1")).toEqual([SLOT]);

		store.begin("s1", []);
		expect(store.slots("s1")).toEqual([]);
	});

	it("ends only its own epoch, flushing what is pending first", () => {
		const { store, emitted } = createStore();
		const oldEpoch = store.begin("s1", [SLOT]);
		const epoch = store.begin("s1", [SLOT]);
		store.activate("s1", epoch);
		store.attachViewer("s1", { id: "a" });
		store.record("s1", epoch, push("r1"));
		store.record("s1", epoch, push("r2"));

		store.end("s1", oldEpoch);
		expect(store.epoch("s1")).toBe(epoch);
		expect(store.viewers("s1")).toHaveLength(1);

		store.end("s1", epoch);
		expect(revisions(emitted)).toEqual(["r1", "r2"]);
		expect(store.epoch("s1")).toBeUndefined();
		expect(store.get("s1")).toEqual([]);
		expect(store.viewers("s1")).toEqual([]);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("mints a later epoch for a reused session id even after the clock steps back", () => {
		const { store } = createStore();
		const first = store.begin("s1", [SLOT]);
		store.end("s1", first);

		vi.setSystemTime(500_000);
		const second = store.begin("s1", [SLOT]);
		expect(second).toBe(first + 1);

		const other = store.begin("s2", [SLOT]);
		expect(other).toBe(500_000);
	});

	it("drops a superseded epoch's pending push when a new epoch begins", () => {
		const { store, emitted } = createStore();
		const oldEpoch = store.begin("s1", [SLOT]);
		store.activate("s1", oldEpoch);
		store.record("s1", oldEpoch, push("r1"));
		store.record("s1", oldEpoch, push("r2"));

		store.begin("s1", [SLOT]);
		vi.advanceTimersByTime(200);

		expect(revisions(emitted)).toEqual(["r1"]);
		expect(store.get("s1")).toEqual([]);
	});

	it("keeps state when the host's event sink throws", () => {
		const store = new PluginUiStore({
			emit: () => {
				throw new Error("listener failed");
			},
			onDrop: () => {
				throw new Error("reporter failed");
			},
		});
		const epoch = store.begin("s1", [SLOT]);
		store.activate("s1", epoch);

		expect(() => store.record("s1", epoch, push("r1"))).not.toThrow();
		expect(() =>
			store.record("s1", epoch, { plugin: "p", slot: "x", state: {} }),
		).not.toThrow();
		expect(store.current("s1", SLOT)?.state?.revision).toBe("r1");
	});
});
