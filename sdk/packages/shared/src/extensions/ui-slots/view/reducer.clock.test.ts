import { describe, expect, it } from "vitest";
import { SUGGESTION_EXPOSURE_MS, SUGGESTION_STALE_NOTE_MS } from "./constants";
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
	SESSION,
	stateEvent,
	view,
} from "./harness";
import { reduceSuggestionsLocal } from "./reducer";
import type { SuggestionsLocalEvent } from "./types";

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
