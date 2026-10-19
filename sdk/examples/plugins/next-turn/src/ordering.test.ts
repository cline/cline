import { describe, expect, test } from "bun:test";
import {
	applyPluginUiState,
	createSuggestionsLocal,
	type PluginUiStateEnvelope,
	reduceSuggestionsLocal,
} from "@cline/shared";
import { sessionHarness } from "./planner/session/session.fixtures";
import type { TrayPush } from "./planner/tray/tray";
import { toSuggestionsState } from "./planner/tray/view";
import { editRun } from "./test-support/agent-runs";
import { useTempDirs } from "./test-support/temp-dirs";

const tempDir = useTempDirs("next-turn-order-");
const harness = sessionHarness(tempDir);

/**
 * The three ordering layers a set passes: the plugin's own `seq`, the
 * envelope's `(epoch, seq)` and the tray reducer's screen state. Each has
 * unit tests; this drives one turn's real pushes through all three, with an
 * older push arriving last.
 */
describe("a turn's pushes through the envelope and the tray reducer", () => {
	test("every layer keeps the newest set when the pushes arrive out of order", async () => {
		const { session } = harness();
		const pushes: TrayPush[] = [];
		session.onPush((push) => pushes.push(push));
		await session.afterRun(editRun().result);
		await session.settled();
		expect(pushes.length).toBeGreaterThanOrEqual(2);

		const seqs = pushes.map((push) => push.seq);
		expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
		expect(new Set(seqs).size).toBe(seqs.length);

		const envelopes: PluginUiStateEnvelope<"composer.suggestions">[] =
			pushes.map((push) => ({
				sessionId: push.sessionId,
				slot: "composer.suggestions",
				plugin: "next-turn",
				epoch: 7,
				seq: push.seq,
				state: toSuggestionsState(push),
			}));
		const newest = envelopes.at(-1);
		const first = envelopes[0];
		if (!newest || !first) throw new Error("the turn pushed no set");

		let held = applyPluginUiState(undefined, first);
		for (const envelope of [...envelopes].reverse())
			held = applyPluginUiState(held, envelope);
		expect(held.seq).toBe(newest.seq);

		let local = reduceSuggestionsLocal(createSuggestionsLocal(), {
			type: "bind",
			sessionId: "sess_1",
		});
		for (const envelope of [...envelopes].reverse())
			local = reduceSuggestionsLocal(local, {
				type: "state",
				envelope,
				now: 1,
			});
		expect(local.envelope?.seq).toBe(newest.seq);
		expect(local.envelope?.state).toEqual(newest.state);
	});

	test("a newer set from the next turn replaces the older one after it", async () => {
		const { session } = harness();
		const pushes: TrayPush[] = [];
		session.onPush((push) => pushes.push(push));
		await session.afterRun(editRun().result);
		await session.settled();
		const before = pushes.at(-1);
		await session.afterRun(editRun("And now the next thing").result);
		await session.settled();
		const after = pushes.at(-1);
		if (!before || !after) throw new Error("the turns pushed no set");
		expect(after.seq).toBeGreaterThan(before.seq);

		const envelope = (
			push: TrayPush,
		): PluginUiStateEnvelope<"composer.suggestions"> => ({
			sessionId: push.sessionId,
			slot: "composer.suggestions",
			plugin: "next-turn",
			epoch: 7,
			seq: push.seq,
			state: toSuggestionsState(push),
		});
		let local = reduceSuggestionsLocal(createSuggestionsLocal(), {
			type: "bind",
			sessionId: "sess_1",
		});
		for (const push of [before, after])
			local = reduceSuggestionsLocal(local, {
				type: "state",
				envelope: envelope(push),
				now: 1,
			});
		expect(local.envelope?.seq).toBe(after.seq);
	});
});