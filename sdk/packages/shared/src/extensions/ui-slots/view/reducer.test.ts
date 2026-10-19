import { describe, expect, it } from "vitest";
import { SUGGESTION_PENDING_UNDO_MS } from "./constants";
import {
	bound,
	EPOCH,
	envelope,
	NOW,
	nextSet,
	OTHER_SESSION,
	readyOnScreen,
	readyThree,
	readyView,
	reduce,
	reply,
	SESSION,
	stateEvent,
	states,
	verifyRef,
	view,
} from "./harness";
import { createSuggestionsLocal, reduceSuggestionsLocal } from "./reducer";
import type { SuggestionsLocalEvent } from "./types";

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

	it("leaves a suggestion used during a one-key Send's verdict wait in place", () => {
		const local = readyOnScreen(
			{ type: "used", itemId: "commit" },
			{ type: "sent", ref: verifyRef },
		);

		expect(local.sent).toEqual(verifyRef);
		expect(local.used).toMatchObject({ itemId: "commit", revision: "r2" });
	});
});

describe("ordering in the reducer", () => {
	it("ignores a state that is not newer than the one held", () => {
		const local = readyOnScreen(
			{ type: "attached", sessionId: SESSION, outcome: "ok", epoch: EPOCH - 1 },
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
			{ type: "attached", sessionId: SESSION, outcome: "ok", epoch: EPOCH - 1 },
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
			outcome: "ok",
			epoch: EPOCH,
		});
		const due = reduce(
			local,
			stateEvent(envelope(nextSet, 1, { epoch: EPOCH + 5 })),
		);
		const foreign = reduceSuggestionsLocal(due, {
			type: "attached",
			sessionId: OTHER_SESSION,
			outcome: "ok",
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
