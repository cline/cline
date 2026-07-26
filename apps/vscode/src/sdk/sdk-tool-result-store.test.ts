import { describe, expect, it } from "vitest"
import { SdkToolResultStore } from "./sdk-tool-result-store"

describe("SdkToolResultStore", () => {
	it("keeps full output out of the presentation reference and retrieves it on demand", () => {
		const store = new SdkToolResultStore({ previewChars: 12 })
		const full = "first line\nsecond line\nsecret tail"
		const reference = store.put({
			sessionId: "session-1",
			toolCallId: "tool-1",
			toolName: "run_commands",
			content: full,
		})

		expect(reference.preview).not.toContain("secret tail")
		expect(reference).not.toHaveProperty("content")
		expect(store.get(reference.id)?.content).toBe(full)
	})

	it("labels retained output that exceeds the bounded result limit", () => {
		const store = new SdkToolResultStore({ maxResultChars: 5 })
		const reference = store.put({ sessionId: "s", toolName: "search", content: "123456789" })

		expect(reference.truncated).toBe(true)
		expect(store.get(reference.id)).toMatchObject({ content: "12345", truncated: true })
	})
})
