import { beforeEach, describe, expect, it } from "vitest"
import { getPromptTypingMs, promptTimingKey, recordPromptTypingMs } from "./promptTimings"

const SESSION = 1_000
const STORAGE_KEY = "ccline.promptTimings.v1"

/**
 * This vitest/jsdom setup exposes no `localStorage` global (Node shadows it), so the tests install
 * a minimal in-memory one. The module itself only ever touches getItem/setItem, and every access
 * is guarded, so this exercises the real code path rather than a mock of it.
 */
function installMemoryStorage() {
	const data = new Map<string, string>()
	const storage = {
		getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
		setItem: (k: string, v: string) => void data.set(k, v),
		removeItem: (k: string) => void data.delete(k),
		clear: () => data.clear(),
	}
	Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true })
	return { data, storage }
}

let memory: { data: Map<string, string>; storage: ReturnType<typeof installMemoryStorage>["storage"] }

beforeEach(() => {
	memory = installMemoryStorage() as never
})

/** The raw persisted object, for assertions about eviction and keying. */
function stored(): Record<string, number> {
	return JSON.parse(memory.data.get(STORAGE_KEY) ?? "{}")
}

describe("promptTimings", () => {
	it("round-trips a recorded typing duration", () => {
		recordPromptTypingMs(SESSION, 2_000, 42_100)

		expect(getPromptTypingMs(SESSION, 2_000)).toBe(42_100)
	})

	it("keeps sessions and prompts apart", () => {
		recordPromptTypingMs(SESSION, 2_000, 1_000)
		recordPromptTypingMs(SESSION, 3_000, 2_000)
		recordPromptTypingMs(SESSION + 1, 2_000, 9_000)

		expect(getPromptTypingMs(SESSION, 2_000)).toBe(1_000)
		expect(getPromptTypingMs(SESSION, 3_000)).toBe(2_000)
		expect(getPromptTypingMs(SESSION + 1, 2_000)).toBe(9_000)
	})

	it("returns undefined when nothing was recorded", () => {
		expect(getPromptTypingMs(SESSION, 7_777)).toBeUndefined()
	})

	it("ignores nonsense measurements", () => {
		recordPromptTypingMs(SESSION, 1, 0)
		recordPromptTypingMs(SESSION, 2, -5)
		recordPromptTypingMs(SESSION, 3, Number.NaN)

		expect(getPromptTypingMs(SESSION, 1)).toBeUndefined()
		expect(getPromptTypingMs(SESSION, 2)).toBeUndefined()
		expect(getPromptTypingMs(SESSION, 3)).toBeUndefined()
	})

	it("overwrites a re-recorded prompt instead of duplicating it", () => {
		recordPromptTypingMs(SESSION, 5, 1_000)
		recordPromptTypingMs(SESSION, 5, 2_500)

		expect(getPromptTypingMs(SESSION, 5)).toBe(2_500)
		expect(Object.keys(stored())).toHaveLength(1)
	})

	it("survives a corrupted store", () => {
		memory.storage.setItem(STORAGE_KEY, "{not json")

		expect(getPromptTypingMs(SESSION, 1)).toBeUndefined()
		expect(() => recordPromptTypingMs(SESSION, 1, 500)).not.toThrow()
		expect(getPromptTypingMs(SESSION, 1)).toBe(500)
	})

	it("evicts the oldest entries past the cap", () => {
		for (let ts = 0; ts < 850; ts++) {
			recordPromptTypingMs(SESSION, ts, 100)
		}
		const store = stored()

		expect(Object.keys(store).length).toBeLessThanOrEqual(800)
		expect(getPromptTypingMs(SESSION, 0)).toBeUndefined()
		expect(getPromptTypingMs(SESSION, 849)).toBe(100)
	})

	it("keys by session and prompt timestamp", () => {
		expect(promptTimingKey(1, 2)).toBe("1:2")
	})
})
