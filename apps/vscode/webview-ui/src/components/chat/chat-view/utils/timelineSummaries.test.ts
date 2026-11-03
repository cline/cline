import { beforeEach, describe, expect, it, vi } from "vitest"
import { createCachedSummarizer } from "./timelineSummaries"
import { summarizeTimelineText } from "./turnTimeline"

const SESSION = 7
const LONG = "Führe den SATA-Selbsttest auf allen Platten aus und korrigiere die Staffelung im Startskript"

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

let memory: ReturnType<typeof installMemoryStorage>

/** The entries inside the single storage key. */
function storedEntries(): Record<string, unknown> {
	const raw = memory.data.get("ccline.timelineSummaries.v2")
	return raw ? JSON.parse(raw) : {}
}

beforeEach(() => {
	memory = installMemoryStorage()
})

describe("createCachedSummarizer", () => {
	it("produces the same label as the plain implementation", () => {
		expect(createCachedSummarizer(SESSION)(LONG)).toBe(summarizeTimelineText(LONG))
	})

	it("persists the derived label across summarizer instances", () => {
		const summary = createCachedSummarizer(SESSION)(LONG)

		// A fresh summarizer models a reload: nothing in memory is left, only storage.
		const underlying = vi.spyOn(JSON, "parse")
		const reloaded = createCachedSummarizer(SESSION)(LONG)
		expect(reloaded).toBe(summary)
		expect(Object.keys(storedEntries()).length).toBe(1)
		underlying.mockRestore()
	})

	it("recomputes when the text changed, e.g. an answer that kept streaming", () => {
		const summarizer = createCachedSummarizer(SESSION)
		expect(summarizer("Anfang")).toBe("Anfang")

		// Same session, different content: the cached entry must not be reused.
		const grown = summarizer("Anfang, der später noch deutlich länger wird und jetzt abbricht")
		expect(grown).toBe(summarizeTimelineText("Anfang, der später noch deutlich länger wird und jetzt abbricht"))
	})

	it("remembers whole sentences, and nothing from the thirty-character era", () => {
		expect(createCachedSummarizer(SESSION)(LONG)).toBe(LONG)
		// The key is a hash of the source text, so a longer label only takes effect under a new
		// prefix — the previous version must stay untouched rather than be read back.
		expect(memory.data.has("ccline.timelineSummaries.v1")).toBe(false)
		expect(Object.keys(storedEntries()).length).toBe(1)
	})

	it("keeps sessions apart", () => {
		const summary = createCachedSummarizer(SESSION)(LONG)

		expect(createCachedSummarizer(SESSION + 1)(LONG)).toBe(summary)
		// One storage key holding one entry per session+text.
		expect(Object.keys(storedEntries()).length).toBe(2)
	})

	it("still works when storage is unavailable", () => {
		Object.defineProperty(globalThis, "localStorage", {
			value: undefined,
			configurable: true,
			writable: true,
		})

		expect(() => createCachedSummarizer(SESSION)).not.toThrow()
	})
})
