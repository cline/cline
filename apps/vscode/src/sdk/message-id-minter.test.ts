import { describe, expect, it } from "vitest"
import { MessageIdMinter } from "./message-id-minter"

describe("MessageIdMinter", () => {
	it("mints strictly increasing, unique ids", () => {
		const minter = new MessageIdMinter()
		const ids = Array.from({ length: 1000 }, () => minter.nextId())
		// strictly increasing
		for (let i = 1; i < ids.length; i++) {
			expect(ids[i]).toBeGreaterThan(ids[i - 1])
		}
		// unique
		expect(new Set(ids).size).toBe(ids.length)
	})

	it("never reads the clock — ids are deterministic from the seed", () => {
		const a = new MessageIdMinter(0)
		const b = new MessageIdMinter(0)
		expect([a.nextId(), a.nextId(), a.nextId()]).toEqual([b.nextId(), b.nextId(), b.nextId()])
	})

	it("respects a starting seed so ids stay increasing across constructions", () => {
		const first = new MessageIdMinter(0)
		first.nextId()
		first.nextId()
		const next = new MessageIdMinter(first.epoch /* irrelevant */ + 2)
		// A fresh minter seeded past the previous high water never reuses an old id.
		expect(next.nextId()).toBeGreaterThan(2)
	})

	it("seq advances independently of id", () => {
		const minter = new MessageIdMinter()
		minter.nextId()
		const s1 = minter.nextSeq()
		minter.nextId()
		minter.nextId()
		const s2 = minter.nextSeq()
		expect(s2).toBeGreaterThan(s1)
		expect(minter.seq).toBe(s2)
	})

	it("epoch only advances on bumpEpoch, independent of id/seq", () => {
		const minter = new MessageIdMinter()
		expect(minter.epoch).toBe(0)
		minter.nextId()
		minter.nextSeq()
		expect(minter.epoch).toBe(0)
		expect(minter.bumpEpoch()).toBe(1)
		expect(minter.bumpEpoch()).toBe(2)
		expect(minter.epoch).toBe(2)
	})

	it("the three counters are mutually independent", () => {
		const minter = new MessageIdMinter()
		minter.nextId()
		minter.nextId()
		minter.bumpEpoch()
		minter.nextSeq()
		// id advanced by 2, seq by 1, epoch by 1 — no cross-contamination
		expect(minter.nextId()).toBe(3)
		expect(minter.nextSeq()).toBe(2)
		expect(minter.bumpEpoch()).toBe(2)
	})

	it("models the cross-generator collision scenario being prevented: one shared minter cannot collide", () => {
		// Simulate the old bug: the translator and the interaction coordinator both mint from the
		// SAME shared minter. Interleave them arbitrarily; ids must remain globally unique.
		const minter = new MessageIdMinter()
		const translatorIds: number[] = []
		const interactionIds: number[] = []
		for (let i = 0; i < 50; i++) {
			translatorIds.push(minter.nextId())
			if (i % 3 === 0) {
				interactionIds.push(minter.nextId())
			}
		}
		const all = [...translatorIds, ...interactionIds]
		expect(new Set(all).size).toBe(all.length)
	})
})
