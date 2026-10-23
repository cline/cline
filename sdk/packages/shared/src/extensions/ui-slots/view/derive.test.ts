import { describe, expect, it } from "vitest";
import { SUGGESTION_BREAKPOINTS, SUGGESTION_STALE_NOTE_MS } from "./constants";
import {
	bound,
	envelope,
	NOW,
	nextSet,
	readyOnScreen,
	readyThree,
	readyView,
	reduce,
	reply,
	stateEvent,
	states,
	verifyRef,
	view,
} from "./harness";

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
