import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { applyMessage, applyStateSnapshot, applyTurnState, createReplicaState, type ReplicaState } from "./messageReducer"

function msg(ts: number, seq: number, epoch: number, partial = false, text = `m${ts}`): ClineMessage {
	return { ts, type: "say", say: "text", text, partial, seq, epoch }
}

function texts(state: ReplicaState): string[] {
	return state.messages.map((m) => m.text ?? "")
}

function tsList(state: ReplicaState): number[] {
	return state.messages.map((m) => m.ts)
}

describe("messageReducer — deterministic", () => {
	it("partial -> final with same ts updates in place (length stays 1, partial ends false)", () => {
		let s = createReplicaState()
		s = applyMessage(s, msg(1, 1, 1, true, "Hel"))
		s = applyMessage(s, msg(1, 2, 1, true, "Hello"))
		s = applyMessage(s, msg(1, 3, 1, false, "Hello world"))
		expect(s.messages).toHaveLength(1)
		expect(s.messages[0].partial).toBe(false)
		expect(s.messages[0].text).toBe("Hello world")
	})

	it("a lower-seq copy of an existing ts is ignored (out-of-order delivery)", () => {
		let s = createReplicaState()
		s = applyMessage(s, msg(1, 3, 1, false, "final"))
		s = applyMessage(s, msg(1, 2, 1, true, "stale-partial"))
		expect(s.messages).toHaveLength(1)
		expect(s.messages[0].text).toBe("final")
		expect(s.messages[0].partial).toBe(false)
	})

	it("RC2: a same-epoch snapshot omitting the last message does NOT shrink the transcript", () => {
		let s = createReplicaState()
		s = applyMessage(s, msg(1, 1, 1, false, "task"))
		s = applyMessage(s, msg(2, 2, 1, false, "text"))
		const ask: ClineMessage = { ts: 3, type: "ask", ask: "completion_result", text: "", seq: 3, epoch: 1 }
		s = applyMessage(s, ask)
		expect(tsList(s)).toEqual([1, 2, 3])

		// A stale full-state snapshot (captured before the ask landed) must NOT drop the ask.
		const staleSnapshot = [msg(1, 1, 1, false, "task"), msg(2, 2, 1, false, "text")]
		s = applyStateSnapshot(s, staleSnapshot, 1, 2)
		expect(tsList(s)).toEqual([1, 2, 3])
		expect(s.messages[2].ask).toBe("completion_result")
	})

	it("a newer-epoch snapshot replaces the transcript wholesale", () => {
		let s = createReplicaState()
		s = applyMessage(s, msg(1, 1, 1, false, "old-task"))
		s = applyMessage(s, msg(2, 2, 1, false, "old-text"))
		s = applyStateSnapshot(s, [msg(10, 1, 2, false, "new-task")], 2, 5)
		expect(texts(s)).toEqual(["new-task"])
		expect(s.epoch).toBe(2)
	})

	it("a message from an older epoch is dropped (straggler from a previous task/render)", () => {
		let s = createReplicaState()
		s = applyStateSnapshot(s, [msg(10, 1, 2, false, "current")], 2, 1)
		s = applyMessage(s, msg(99, 1, 1, false, "straggler"))
		expect(texts(s)).toEqual(["current"])
	})

	it("an older-version snapshot at the same epoch is ignored wholesale", () => {
		let s = createReplicaState()
		s = applyStateSnapshot(s, [msg(1, 1, 1), msg(2, 2, 1), msg(3, 3, 1)], 1, 10)
		s = applyStateSnapshot(s, [msg(1, 1, 1)], 1, 5)
		expect(tsList(s)).toEqual([1, 2, 3])
	})

	it("unstamped (classic/legacy) messages merge at epoch 0 by ts", () => {
		let s = createReplicaState()
		const a: ClineMessage = { ts: 1, type: "say", say: "text", text: "a" }
		const b: ClineMessage = { ts: 2, type: "say", say: "text", text: "b" }
		s = applyMessage(s, a)
		s = applyMessage(s, b)
		expect(tsList(s)).toEqual([1, 2])
	})

	// Order independence (property-based via explicit permutations) -------------

	function canonical(log: ClineMessage[]): ReplicaState {
		let s = createReplicaState()
		for (const m of log) {
			s = applyMessage(s, m)
		}
		return s
	}

	function permutations<T>(arr: T[]): T[][] {
		if (arr.length <= 1) {
			return [arr.slice()]
		}
		const result: T[][] = []
		for (let i = 0; i < arr.length; i++) {
			const rest = [...arr.slice(0, i), ...arr.slice(i + 1)]
			for (const p of permutations(rest)) {
				result.push([arr[i], ...p])
			}
		}
		return result
	}

	function normalize(state: ReplicaState): Array<{ ts: number; text: string; partial: boolean; ask?: string }> {
		return [...state.messages]
			.sort((a, b) => a.ts - b.ts)
			.map((m) => ({ ts: m.ts, text: m.text ?? "", partial: m.partial ?? false, ask: m.ask }))
	}

	describe("messageReducer — order independence", () => {
		// A causal log for one epoch: task, streamed text (partial then final, same ts), tool,
		// and a trailing ask. seq reflects causal mint order.
		const log: ClineMessage[] = [
			msg(1, 1, 1, false, "task"),
			msg(2, 2, 1, true, "Hel"),
			msg(2, 3, 1, false, "Hello"),
			msg(3, 4, 1, false, "tool"),
			{ ts: 4, type: "ask", ask: "completion_result", text: "", seq: 5, epoch: 1 },
		]

		it("every delivery permutation converges to the canonical state", () => {
			const expected = normalize(canonical(log))
			const perms = permutations(log)
			expect(perms.length).toBe(120) // 5!
			for (const perm of perms) {
				let s = createReplicaState()
				for (const m of perm) {
					s = applyMessage(s, m)
				}
				expect(normalize(s)).toEqual(expected)
			}
		})

		it("converges even with every event duplicated", () => {
			const expected = normalize(canonical(log))
			for (const perm of permutations(log).slice(0, 24)) {
				let s = createReplicaState()
				for (const m of perm) {
					s = applyMessage(s, m)
					s = applyMessage(s, m)
				}
				expect(normalize(s)).toEqual(expected)
			}
		})

		it("dropping non-final copies still converges once finals arrive in any order", () => {
			const finalsByTs = new Map<number, ClineMessage>()
			for (const m of log) {
				const cur = finalsByTs.get(m.ts)
				if (!cur || (m.seq ?? 0) >= (cur.seq ?? 0)) {
					finalsByTs.set(m.ts, m)
				}
			}
			const finals = [...finalsByTs.values()]
			const expected = normalize(canonical(log))
			for (const perm of permutations(finals)) {
				let s = createReplicaState()
				for (const m of perm) {
					s = applyMessage(s, m)
				}
				expect(normalize(s)).toEqual(expected)
			}
		})
	})

	// --- Regressions from the TurnState cutover (design doc §11) -------------------
	//
	// These encode the two webview-side regressions found after wiring the footer/buttons
	// to read turnState. See apps/vscode/src/sdk/docs/webview-message-state-design.md §11.

	describe("messageReducer — turnState seq gate (Symptom A)", () => {
		it("a snapshot carrying a newer-seq turnState advances the replica's turnState", () => {
			let s = createReplicaState()
			s = applyStateSnapshot(s, [msg(1, 1, 1, false, "task")], 1, 1, { phase: "streaming", seq: 5 })
			expect(s.turnState?.phase).toBe("streaming")
			expect(s.turnState?.seq).toBe(5)
		})

		it("a stale snapshot with an OLDER-seq turnState does NOT revert phase (streaming stays)", () => {
			// The race: phase reaches "streaming" (seq 5); then a late snapshot captured earlier
			// (turnState idle, seq 2) resolves last. Without a seq gate it would revert the footer
			// to idle and hide the Cancel button. The gate must keep "streaming".
			let s = createReplicaState()
			s = applyStateSnapshot(s, [msg(1, 1, 1, false, "task")], 1, 1, { phase: "streaming", seq: 5 })
			s = applyStateSnapshot(s, [msg(1, 1, 1, false, "task")], 1, 2, { phase: "idle", seq: 2 })
			expect(s.turnState?.phase).toBe("streaming")
			expect(s.turnState?.seq).toBe(5)
		})

		it("turnState moves forward when a newer-seq update arrives, regardless of arrival order", () => {
			let s = createReplicaState()
			// Deliver the newer one first, then an older straggler.
			s = applyTurnState(s, { phase: "completed", seq: 9 })
			s = applyTurnState(s, { phase: "streaming", seq: 4 })
			expect(s.turnState?.phase).toBe("completed")
			expect(s.turnState?.seq).toBe(9)
		})

		it("a newer epoch resets turnState along with the transcript", () => {
			let s = createReplicaState()
			s = applyStateSnapshot(s, [msg(1, 1, 1, false, "old")], 1, 1, { phase: "completed", seq: 9 })
			// New task at a fresh epoch: the old completed turnState must not leak in.
			s = applyStateSnapshot(s, [msg(10, 1, 2, false, "new")], 2, 1, { phase: "streaming", seq: 1 })
			expect(s.turnState?.phase).toBe("streaming")
			expect(s.turnState?.seq).toBe(1)
			expect(texts(s)).toEqual(["new"])
		})
	})

	describe("messageReducer — transcript is never emptied for a live conversation (Symptom B)", () => {
		it("a same-epoch snapshot with an empty transcript does NOT clear an existing one", () => {
			// A bookkeeping/empty snapshot must not wipe a populated transcript and strand the
			// webview at messages.length === 0 (which routes Enter to newTask()).
			let s = createReplicaState()
			s = applyStateSnapshot(s, [msg(1, 1, 1, false, "task"), msg(2, 2, 1, false, "answer")], 1, 1)
			s = applyStateSnapshot(s, [], 1, 2)
			expect(tsList(s)).toEqual([1, 2])
		})

		it("a lone newer-epoch partial does NOT discard a populated transcript", () => {
			// If an epoch bump races ahead of the full snapshot, a single newer-epoch partial
			// must not be treated as the entire new transcript (which would empty the task).
			let s = createReplicaState()
			s = applyStateSnapshot(s, [msg(1, 1, 1, false, "task"), msg(2, 2, 1, false, "answer")], 1, 5)
			// A stray bookkeeping partial stamped at a higher epoch but with no real content.
			const stray: ClineMessage = { ts: 99, type: "say", say: "api_req_started", text: "{}", seq: 1, epoch: 2 }
			s = applyMessage(s, stray)
			// The transcript must still contain the real conversation, not just the stray row.
			expect(tsList(s)).toContain(1)
			expect(tsList(s)).toContain(2)
		})
	})
})
