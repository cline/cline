import { describe, expect, it } from "vitest";
import type {
	ComposerSuggestionsState,
	PluginUiInvokeResult,
	PluginUiStateEnvelope,
} from "./ui-slots";
import { PLUGIN_UI_FIXTURES } from "./ui-slots.fixtures";
import {
	createSuggestionsLocal,
	deriveSuggestionsView,
	reduceSuggestionsLocal,
	SUGGESTION_BREAKPOINTS,
	SUGGESTION_EXPOSURE_MS,
	SUGGESTION_PENDING_UNDO_MS,
	SUGGESTION_STALE_NOTE_MS,
	type SuggestionRef,
	type SuggestionsHostFacts,
	type SuggestionsLocal,
	type SuggestionsLocalEvent,
	type SuggestionsView,
} from "./ui-slots-view";

const SESSION = "sess_a";
const OTHER_SESSION = "sess_b";
const EPOCH = 1_000;
const NOW = 50_000;
const states = PLUGIN_UI_FIXTURES.composerSuggestions;
const { readyThree } = states;

type Envelope = PluginUiStateEnvelope<"composer.suggestions">;

function envelope(
	state: ComposerSuggestionsState | null,
	seq: number,
	options: { epoch?: number; sessionId?: string } = {},
): Envelope {
	return {
		sessionId: options.sessionId ?? SESSION,
		slot: "composer.suggestions",
		plugin: "demo",
		epoch: options.epoch ?? EPOCH,
		seq,
		state,
	};
}

function stateEvent(env: Envelope, now = NOW): SuggestionsLocalEvent {
	return { type: "state", envelope: env, now };
}

function reply(
	result: PluginUiInvokeResult<"composer.suggestions">,
	sessionId = SESSION,
	now = NOW,
): SuggestionsLocalEvent {
	return { type: "reply", sessionId, result, now };
}

function reduce(
	local: SuggestionsLocal,
	...events: SuggestionsLocalEvent[]
): SuggestionsLocal {
	return events.reduce(reduceSuggestionsLocal, local);
}

function bound(...events: SuggestionsLocalEvent[]): SuggestionsLocal {
	return reduce(
		createSuggestionsLocal(),
		{ type: "bind", sessionId: SESSION },
		...events,
	);
}

/** Bound with the three-row set on screen since NOW. */
function readyOnScreen(...events: SuggestionsLocalEvent[]): SuggestionsLocal {
	return bound(
		stateEvent(envelope(readyThree, 1)),
		{ type: "view", ready: true, now: NOW },
		...events,
	);
}

function host(
	overrides: Partial<SuggestionsHostFacts> = {},
): SuggestionsHostFacts {
	return {
		draft: "",
		busy: false,
		blocked: false,
		queued: 0,
		canUndo: false,
		width: 800,
		breakpoints: SUGGESTION_BREAKPOINTS.desktop,
		now: NOW,
		...overrides,
	};
}

function view(
	local: SuggestionsLocal,
	overrides: Partial<SuggestionsHostFacts> = {},
): SuggestionsView {
	return deriveSuggestionsView(local, host(overrides));
}

function readyView(
	local: SuggestionsLocal,
	overrides: Partial<SuggestionsHostFacts> = {},
): Extract<SuggestionsView, { mode: "ready" }> {
	const derived = view(local, overrides);
	if (derived.mode !== "ready")
		throw new Error(`expected ready, got ${derived.mode}`);
	return derived;
}

const verifyRef: SuggestionRef = {
	itemId: "verify",
	revision: readyThree.revision,
	prompt: "Run the whole test suite",
	label: "Verify",
	tone: "check",
};

const nextSet: ComposerSuggestionsState = {
	...readyThree,
	revision: "r9",
	items: readyThree.items.slice(1),
};

describe("deriveSuggestionsView precedence", () => {
	it("hides everything while blocked", () => {
		expect(view(readyOnScreen(), { blocked: true })).toEqual({
			mode: "hidden",
		});
		expect(
			view(readyOnScreen({ type: "sent", ref: verifyRef }), {
				blocked: true,
				busy: true,
			}),
		).toEqual({ mode: "hidden" });
	});

	it("shows the sent line before a queue or a run", () => {
		const sent = readyOnScreen({ type: "sent", ref: verifyRef });

		expect(view(sent, { busy: true })).toEqual({
			mode: "sent",
			label: "Verify",
			tone: "check",
			canUndo: false,
		});
		expect(view(sent, { queued: 1 })).toMatchObject({ mode: "sent" });
	});

	it("hides behind a queue when nothing was sent", () => {
		expect(view(readyOnScreen(), { queued: 2 })).toEqual({ mode: "hidden" });
	});

	it("shows working while busy with a plugin state", () => {
		expect(view(readyOnScreen(), { busy: true })).toEqual({ mode: "working" });
	});

	it("shows the stale line until staleUntil", () => {
		const stale = readyOnScreen(reply({ outcome: "refused", reason: "stale" }));

		expect(view(stale)).toEqual({ mode: "stale" });
		expect(view(stale, { now: NOW + SUGGESTION_STALE_NOTE_MS })).toMatchObject({
			mode: "ready",
		});
	});

	it("shows used text and whether it was edited", () => {
		const used = readyOnScreen({ type: "used", itemId: "verify" });

		expect(view(used, { draft: verifyRef.prompt })).toEqual({
			mode: "used",
			label: "Verify",
			tone: "check",
			edited: false,
		});
		expect(view(used, { draft: `${verifyRef.prompt} quickly` })).toMatchObject({
			mode: "used",
			edited: true,
		});
	});

	it("is off for hidden(user) with an empty box, and hidden otherwise", () => {
		const off = bound(stateEvent(envelope(states.hiddenUser, 1)));

		expect(view(off)).toEqual({ mode: "off", title: "Next" });
		expect(view(off, { draft: "typing" })).toEqual({ mode: "hidden" });
		expect(view(bound(stateEvent(envelope(states.hidden, 1))))).toEqual({
			mode: "hidden",
		});
		expect(view(bound(stateEvent(envelope(null, 1))))).toEqual({
			mode: "hidden",
		});
		expect(view(bound())).toEqual({ mode: "hidden" });
	});

	it("yields to the person's draft with the set's tones", () => {
		expect(view(readyOnScreen(), { draft: "my own words" })).toEqual({
			mode: "yielded",
			count: 3,
			tones: ["check", "finish", "decide"],
		});
	});

	it("counts a box holding only whitespace as a draft", () => {
		const off = bound(stateEvent(envelope(states.hiddenUser, 1)));

		for (const draft of [" ", "\n"]) {
			expect(view(readyOnScreen(), { draft })).toMatchObject({
				mode: "yielded",
			});
			expect(view(off, { draft })).toEqual({ mode: "hidden" });
		}
	});

	it("shows loading with the plugin's cue and a row count", () => {
		expect(view(bound(stateEvent(envelope(states.loading, 1))))).toEqual({
			mode: "loading",
			title: "Next",
			cue: states.loading.cue,
			rows: 3,
		});
	});

	it("shows the line modes", () => {
		expect(view(bound(stateEvent(envelope(states.empty, 1))))).toEqual({
			mode: "line",
			kind: "empty",
			title: "Next",
		});
		expect(view(bound(stateEvent(envelope(states.exhausted, 1))))).toEqual({
			mode: "line",
			kind: "exhausted",
			title: "Next",
		});
		expect(view(bound(stateEvent(envelope(states.unavailable, 1))))).toEqual({
			mode: "line",
			kind: "unavailable",
			title: "Next",
			note: states.unavailable.note,
		});
	});

	it("collapses for the revision it was collapsed on", () => {
		const collapsed = readyOnScreen({ type: "collapse" });

		expect(view(collapsed)).toEqual({
			mode: "collapsed",
			title: "Next",
			cue: readyThree.cue,
			count: 3,
		});
		expect(
			view(reduce(collapsed, stateEvent(envelope(nextSet, 2)))),
		).toMatchObject({ mode: "ready" });
	});

	it("shows the ready set", () => {
		expect(view(readyOnScreen())).toEqual({
			mode: "ready",
			density: "full",
			title: "Next",
			cue: readyThree.cue,
			rows: [
				{ item: readyThree.items[0], highlighted: true, source: "none" },
				{ item: readyThree.items[1], highlighted: false, source: "none" },
				{ item: readyThree.items[2], highlighted: false, source: "inline" },
			],
			highlighted: readyThree.items[0],
			position: { index: 0, count: 3 },
			keysEnabled: true,
			canSend: false,
			skipMeans: "skip",
			canRefresh: true,
		});
	});
});

describe("freshness", () => {
	it("hides a ready set or a line that is not newer than the run", () => {
		for (const state of [
			readyThree,
			states.empty,
			states.exhausted,
			states.unavailable,
		]) {
			const local = bound(stateEvent(envelope(state, 1)), {
				type: "run_started",
			});

			expect(view(local)).toEqual({ mode: "hidden" });
			expect(
				view(
					reduce(local, stateEvent(envelope({ ...state, revision: "r9" }, 2))),
				),
			).not.toEqual({ mode: "hidden" });
		}
	});

	it("keeps a set fetched while busy hidden until a newer one arrives", () => {
		const fetched = bound(stateEvent(envelope(readyThree, 4)), {
			type: "run_started",
		});

		expect(view(fetched, { busy: true })).toEqual({ mode: "working" });
		expect(view(fetched)).toEqual({ mode: "hidden" });
		expect(
			view(reduce(fetched, stateEvent(envelope(nextSet, 5)))),
		).toMatchObject({
			mode: "ready",
		});
	});

	it("never yields zero rows for a null or hidden state", () => {
		for (const state of [null, states.hidden, states.hiddenSuperseded]) {
			expect(
				view(bound(stateEvent(envelope(state, 1))), { draft: "mine" }),
			).toEqual({
				mode: "hidden",
			});
		}
	});
});

describe("sent line", () => {
	const sent = readyOnScreen({ type: "sent", ref: verifyRef });

	it("survives a queue, loading and hidden(superseded)", () => {
		expect(view(sent, { queued: 1 })).toMatchObject({ mode: "sent" });
		for (const state of [states.loading, states.hiddenSuperseded]) {
			const local = reduce(sent, stateEvent(envelope(state, 2)));
			expect(local.sent).toEqual(verifyRef);
			expect(view(local)).toMatchObject({ mode: "sent" });
		}
	});

	it("ends at a new set, unavailable and hidden(user)", () => {
		for (const state of [nextSet, states.unavailable, states.hiddenUser]) {
			expect(reduce(sent, stateEvent(envelope(state, 2))).sent).toBeUndefined();
		}
	});

	it("ends when the state is cleared or an unavailable reply drops the tray", () => {
		const cleared = reduce(sent, stateEvent(envelope(null, 2)));
		const dropped = reduce(sent, reply({ outcome: "unavailable" }));

		for (const local of [cleared, dropped]) {
			expect(local.sent).toBeUndefined();
			expect(view(local, { busy: true, canUndo: true })).toEqual({
				mode: "hidden",
			});
			expect(view(local, { queued: 1, canUndo: true })).toEqual({
				mode: "hidden",
			});
		}
	});

	it("follows the host's canUndo", () => {
		expect(view(sent, { busy: true, canUndo: true })).toMatchObject({
			mode: "sent",
			canUndo: true,
		});
		expect(view(sent, { busy: true, canUndo: false })).toMatchObject({
			mode: "sent",
			canUndo: false,
		});
	});

	it("turns back into used when unsent", () => {
		const unsent = reduce(sent, { type: "unsent" });

		expect(unsent.sent).toBeUndefined();
		expect(unsent.used).toEqual(verifyRef);
	});

	it("keeps the captured ref even when a newer state replaced the items", () => {
		const replaced = readyOnScreen(stateEvent(envelope(nextSet, 2)), {
			type: "sent",
			ref: verifyRef,
		});

		expect(replaced.sent).toEqual(verifyRef);
	});

	it("moves used to sent without a ref", () => {
		const local = readyOnScreen(
			{ type: "used", itemId: "commit" },
			{ type: "sent" },
		);

		expect(local.used).toBeUndefined();
		expect(local.sent).toMatchObject({ itemId: "commit", revision: "r2" });
	});
});

describe("exposure clock", () => {
	it("allows Send only after the exposure time on a sendable row", () => {
		const local = readyOnScreen();

		expect(
			readyView(local, { now: NOW + SUGGESTION_EXPOSURE_MS - 1 }).canSend,
		).toBe(false);
		expect(
			readyView(local, { now: NOW + SUGGESTION_EXPOSURE_MS }).canSend,
		).toBe(true);

		const unsendable = reduce(local, {
			type: "highlight",
			itemId: "reply-review",
		});
		expect(
			readyView(unsendable, { now: NOW + SUGGESTION_EXPOSURE_MS }).canSend,
		).toBe(false);
	});

	it("does not advance while yielded, collapsed or off screen", () => {
		const offScreen = readyOnScreen({
			type: "view",
			ready: false,
			now: NOW + 100,
		});
		expect(offScreen.readyAt).toBeUndefined();

		const back = reduce(offScreen, {
			type: "view",
			ready: true,
			now: NOW + 900,
		});
		expect(readyView(back, { now: NOW + 1_000 }).canSend).toBe(false);
		expect(readyView(back, { now: NOW + 1_300 }).canSend).toBe(true);
	});

	it("starts again when a new revision arrives on screen", () => {
		const arrived = NOW + 600;
		const arrivals: SuggestionsLocalEvent[] = [
			stateEvent(envelope(nextSet, 2), arrived),
			reply({ outcome: "ok", state: envelope(nextSet, 2) }, SESSION, arrived),
		];

		for (const arrival of arrivals) {
			const local = readyOnScreen(arrival);

			expect(local.readyAt).toBe(arrived);
			expect(
				readyView(local, { now: arrived + SUGGESTION_EXPOSURE_MS - 1 }).canSend,
			).toBe(false);
			expect(
				readyView(local, { now: arrived + SUGGESTION_EXPOSURE_MS }).canSend,
			).toBe(true);
		}
	});

	it("does not start for a new revision that arrives off screen", () => {
		const local = bound(
			stateEvent(envelope(readyThree, 1)),
			stateEvent(envelope(nextSet, 2), NOW + 600),
		);

		expect(local.readyAt).toBeUndefined();
	});

	it("keeps exposed revisions across a rebind", () => {
		const exposed = readyOnScreen({ type: "exposed", revision: "r2" });
		const rebound = reduce(exposed, { type: "bind", sessionId: SESSION });

		expect(rebound.exposedRevisions.has("r2")).toBe(true);
		expect(reduce(rebound, { type: "exposed", revision: "r2" })).toBe(rebound);
	});

	it("remembers at most the last 32 exposed revisions", () => {
		const local = Array.from({ length: 40 }, (_, index) => `r${index}`).reduce(
			(acc, revision) =>
				reduceSuggestionsLocal(acc, { type: "exposed", revision }),
			bound(),
		);

		expect(local.exposedRevisions.size).toBe(32);
		expect(local.exposedRevisions.has("r7")).toBe(false);
		expect(local.exposedRevisions.has("r39")).toBe(true);
	});
});

describe("epoch re-attach", () => {
	const attached = bound(
		{ type: "attached", sessionId: SESSION, epoch: EPOCH },
		stateEvent(envelope(readyThree, 1)),
	);

	it("is due for an envelope with a newer epoch, and cleared by attached", () => {
		const due = reduce(
			attached,
			stateEvent(envelope(readyThree, 1, { epoch: EPOCH + 5 })),
		);
		expect(due.attachDue).toBe(true);

		const reattached = reduce(due, {
			type: "attached",
			sessionId: SESSION,
			epoch: EPOCH + 5,
		});
		expect(reattached.attachDue).toBe(false);
		expect(reattached.boundEpoch).toBe(EPOCH + 5);
	});

	it("is never due before an attach reply carried an epoch", () => {
		const local = bound(
			stateEvent(envelope(readyThree, 1)),
			stateEvent(envelope(readyThree, 1, { epoch: EPOCH + 5 })),
		);

		expect(local.attachDue).toBe(false);
	});

	it("is due once per epoch when the re-attach reply carries no epoch", () => {
		const due = reduce(
			attached,
			stateEvent(envelope(readyThree, 1, { epoch: EPOCH + 5 })),
		);
		const answered = reduce(due, { type: "attached", sessionId: SESSION });

		expect(answered.attachDue).toBe(false);
		expect(answered.boundEpoch).toBe(EPOCH);
		expect(
			reduce(answered, stateEvent(envelope(nextSet, 2, { epoch: EPOCH + 5 })))
				.attachDue,
		).toBe(false);
		expect(
			reduce(answered, stateEvent(envelope(nextSet, 1, { epoch: EPOCH + 9 })))
				.attachDue,
		).toBe(true);
	});
});

describe("busy", () => {
	it("works for ready, loading and hidden(superseded)", () => {
		for (const state of [readyThree, states.loading, states.hiddenSuperseded]) {
			expect(
				view(bound(stateEvent(envelope(state, 1))), { busy: true }),
			).toEqual({
				mode: "working",
			});
		}
	});

	it("draws nothing without a state, or with the plugin turned off", () => {
		expect(view(bound(), { busy: true })).toEqual({ mode: "hidden" });
		for (const state of [null, states.hiddenDisabled]) {
			expect(
				view(bound(stateEvent(envelope(state, 1))), { busy: true }),
			).toEqual({
				mode: "hidden",
			});
		}
	});

	it("stays off for hidden(user) with an empty box", () => {
		expect(
			view(bound(stateEvent(envelope(states.hiddenUser, 1))), { busy: true }),
		).toEqual({ mode: "off", title: "Next" });
	});
});

describe("ordering in the reducer", () => {
	it("ignores a state that is not newer than the one held", () => {
		const local = readyOnScreen(
			{ type: "attached", sessionId: SESSION, epoch: EPOCH - 1 },
			{ type: "sent", ref: verifyRef },
		);
		const crossing = stateEvent(envelope(nextSet, 1));

		expect(reduceSuggestionsLocal(local, crossing)).toBe(local);
		expect(local.sent).toEqual(verifyRef);
		expect(local.attachDue).toBe(false);
		expect(local.readyAt).toBe(NOW);
	});

	it("ignores a state with a lower seq or epoch than the one held", () => {
		const local = bound(
			stateEvent(envelope(readyThree, 3)),
			{ type: "view", ready: true, now: NOW },
			{ type: "attached", sessionId: SESSION, epoch: EPOCH - 1 },
			{ type: "sent", ref: verifyRef },
		);

		for (const late of [
			envelope(nextSet, 2),
			envelope(nextSet, 9, { epoch: EPOCH - 1 }),
		]) {
			expect(reduceSuggestionsLocal(local, stateEvent(late, NOW + 100))).toBe(
				local,
			);
		}
	});
});

describe("skip and refresh", () => {
	it("means more on the last row when a new set is available", () => {
		const last = readyOnScreen({ type: "highlight", itemId: "reply-review" });

		expect(readyView(readyOnScreen()).skipMeans).toBe("skip");
		expect(readyView(last).skipMeans).toBe("more");
		expect(
			readyView(
				bound(stateEvent(envelope({ ...readyThree, canRefresh: false }, 1)), {
					type: "highlight",
					itemId: "reply-review",
				}),
			).skipMeans,
		).toBe("skip");
	});

	it("hides a skipped row and keeps the highlight in place", () => {
		const skipped = readyOnScreen({
			type: "skip_pending",
			itemId: "verify",
			now: NOW,
		});
		const derived = readyView(skipped);

		expect(derived.rows.map((row) => row.item.id)).toEqual([
			"commit",
			"reply-review",
		]);
		expect(derived.highlighted.id).toBe("commit");
	});

	it("rolls a skip or a refresh back on rejected or timeout", () => {
		const pendings: SuggestionsLocalEvent[] = [
			{ type: "skip_pending", itemId: "verify", now: NOW },
			{ type: "refresh_pending", now: NOW },
		];

		for (const pending of pendings) {
			for (const outcome of ["rejected", "timeout"] as const) {
				const local = readyOnScreen(pending, reply({ outcome }));

				expect(local.pendingSkipIds).toEqual([]);
				expect(local.refreshing).toBe(false);
				expect(local.pendingSince).toBeUndefined();
				expect(readyView(local).rows).toHaveLength(3);
			}
		}
	});

	it("rolls back a skip and a refresh with no reply after 2 s", () => {
		const pending = readyOnScreen(
			{ type: "skip_pending", itemId: "verify", now: NOW },
			{ type: "refresh_pending", now: NOW + 500 },
		);
		expect(view(pending)).toMatchObject({
			mode: "loading",
			cue: { text: "finding different suggestions…" },
		});

		const early = {
			type: "tick",
			now: NOW + SUGGESTION_PENDING_UNDO_MS - 1,
		} as const;
		expect(reduceSuggestionsLocal(pending, early)).toBe(pending);

		const undone = reduce(pending, {
			type: "tick",
			now: NOW + SUGGESTION_PENDING_UNDO_MS,
		});
		expect(undone.pendingSkipIds).toEqual([]);
		expect(undone.refreshing).toBe(false);
		expect(undone.pendingSince).toBeUndefined();
		expect(readyView(undone).rows).toHaveLength(3);
	});

	it("resolves the optimistic paint when the new set arrives", () => {
		const local = readyOnScreen(
			{ type: "skip_pending", itemId: "verify", now: NOW },
			stateEvent(envelope(nextSet, 2)),
			reply({ outcome: "ok", state: envelope(nextSet, 2) }),
		);

		expect(local.pendingSkipIds).toEqual([]);
		expect(local.pendingSince).toBeUndefined();
		expect(readyView(local).rows.map((row) => row.item.id)).toEqual([
			"commit",
			"reply-review",
		]);
	});

	it("drops the tray on unavailable without a state, and keeps it with one", () => {
		const dropped = readyOnScreen(reply({ outcome: "unavailable" }));
		expect(dropped.envelope).toBeUndefined();
		expect(view(dropped)).toEqual({ mode: "hidden" });

		const kept = readyOnScreen(
			reply({
				outcome: "unavailable",
				state: envelope(nextSet, 2),
				epoch: EPOCH,
			}),
		);
		expect(kept.envelope).toEqual(envelope(nextSet, 2));
		expect(readyView(kept).rows.map((row) => row.item.id)).toEqual([
			"commit",
			"reply-review",
		]);
	});

	it("shows a loading set while every row is pending a skip", () => {
		const local = readyOnScreen(
			...readyThree.items.map(
				(item): SuggestionsLocalEvent => ({
					type: "skip_pending",
					itemId: item.id,
					now: NOW,
				}),
			),
		);

		expect(view(local)).toMatchObject({ mode: "loading", rows: 3 });
	});
});

describe("density", () => {
	it.each([
		["desktop", 600, "full"],
		["desktop", 450, "narrow"],
		["desktop", 399, "compact"],
		["ide", 520, "full"],
		["ide", 300, "narrow"],
		["ide", 279, "compact"],
		["cli", 80, "full"],
		["cli", 70, "narrow"],
		["cli", 59, "compact"],
	] as const)("%s at %d is %s", (surface, width, density) => {
		expect(
			readyView(readyOnScreen(), {
				width,
				breakpoints: SUGGESTION_BREAKPOINTS[surface],
			}).density,
		).toBe(density);
	});

	it("places a link as an icon when narrow and in the why line when compact", () => {
		const sourceOf = (width: number) =>
			readyView(readyOnScreen(), { width }).rows[2].source;

		expect(sourceOf(600)).toBe("inline");
		expect(sourceOf(450)).toBe("icon");
		expect(sourceOf(350)).toBe("in-detail");
	});
});

describe("session guard", () => {
	it("ignores a reply whose state names another session with a higher epoch", () => {
		const local = readyOnScreen();
		const foreign = reply({
			outcome: "ok",
			state: envelope(nextSet, 1, {
				sessionId: OTHER_SESSION,
				epoch: EPOCH + 50,
			}),
		});

		expect(reduceSuggestionsLocal(local, foreign)).toBe(local);
	});

	it("ignores a state for another session", () => {
		const local = readyOnScreen();
		const foreign = stateEvent(
			envelope(nextSet, 9, { sessionId: OTHER_SESSION, epoch: EPOCH + 50 }),
		);

		expect(reduceSuggestionsLocal(local, foreign)).toBe(local);
	});

	it("keeps the bound envelope on an unavailable reply for another session", () => {
		const local = readyOnScreen();

		expect(
			reduceSuggestionsLocal(
				local,
				reply({ outcome: "unavailable" }, OTHER_SESSION),
			),
		).toBe(local);
	});

	it("ignores attached for another session", () => {
		const local = readyOnScreen({
			type: "attached",
			sessionId: SESSION,
			epoch: EPOCH,
		});
		const due = reduce(
			local,
			stateEvent(envelope(nextSet, 1, { epoch: EPOCH + 5 })),
		);
		const foreign = reduceSuggestionsLocal(due, {
			type: "attached",
			sessionId: OTHER_SESSION,
			epoch: EPOCH + 99,
		});

		expect(foreign).toBe(due);
		expect(foreign.boundEpoch).toBe(EPOCH);
		expect(foreign.attachDue).toBe(true);
	});

	it("records the session on bind and clears everything but exposed revisions", () => {
		const local = readyOnScreen(
			{ type: "used", itemId: "verify" },
			{ type: "exposed", revision: "r2" },
			{ type: "bind", sessionId: OTHER_SESSION },
		);

		expect(local).toEqual({
			...createSuggestionsLocal(),
			sessionId: OTHER_SESSION,
			exposedRevisions: new Set(["r2"]),
		});
	});
});

describe("clock", () => {
	it("allows Send at readyAt + 400 with no event in between", () => {
		const local = readyOnScreen();

		expect(readyView(local, { now: NOW + 399 }).canSend).toBe(false);
		expect(readyView(local, { now: NOW + 400 }).canSend).toBe(true);
	});

	it("undoes pending changes at pendingSince + 2 s and not before", () => {
		const pending = readyOnScreen({
			type: "skip_pending",
			itemId: "commit",
			now: NOW,
		});

		expect(
			reduceSuggestionsLocal(pending, { type: "tick", now: NOW + 1_999 }),
		).toBe(pending);
		expect(
			reduce(pending, { type: "tick", now: NOW + 2_000 }).pendingSkipIds,
		).toEqual([]);
	});

	it("returns the same object for a tick with no deadline", () => {
		const local = readyOnScreen();
		expect(
			reduceSuggestionsLocal(local, { type: "tick", now: NOW + 9_999 }),
		).toBe(local);
	});

	it("ends the stale line on the first derivation after staleUntil", () => {
		const stale = readyOnScreen(
			reply({ outcome: "refused", reason: "stale" }, SESSION, NOW),
		);

		expect(view(stale, { now: NOW + SUGGESTION_STALE_NOTE_MS - 1 })).toEqual({
			mode: "stale",
		});
		expect(view(stale, { now: NOW + SUGGESTION_STALE_NOTE_MS })).toMatchObject({
			mode: "ready",
		});
	});
});

describe("identity", () => {
	it("returns the same object for a view with an unchanged ready", () => {
		const local = readyOnScreen();

		expect(
			reduceSuggestionsLocal(local, {
				type: "view",
				ready: true,
				now: NOW + 5,
			}),
		).toBe(local);
		const off = reduce(local, { type: "view", ready: false, now: NOW + 5 });
		expect(
			reduceSuggestionsLocal(off, { type: "view", ready: false, now: NOW + 6 }),
		).toBe(off);
	});
});

describe("highlight", () => {
	it("wraps when moving past either end", () => {
		const local = readyOnScreen();

		expect(
			readyView(reduce(local, { type: "move", delta: -1 })).highlighted.id,
		).toBe("reply-review");
		expect(
			readyView(
				reduce(
					local,
					{ type: "move", delta: 1 },
					{ type: "move", delta: 1 },
					{ type: "move", delta: 1 },
				),
			).highlighted.id,
		).toBe("verify");
	});

	it("starts at the first row after a run starts", () => {
		const local = readyOnScreen(
			{ type: "highlight", itemId: "commit" },
			{ type: "run_started" },
			stateEvent(envelope(readyThree, 2)),
		);

		expect(readyView(local).highlighted.id).toBe("verify");
	});
});
