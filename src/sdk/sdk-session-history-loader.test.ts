import { beforeEach, describe, expect, it, vi } from "vitest"
import { SdkSessionHistoryLoader } from "./sdk-session-history-loader"

const getSavedApiConversationHistory = vi.fn().mockResolvedValue([])

vi.mock("@core/storage/disk", () => ({
	getSavedApiConversationHistory,
}))

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		log: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

describe("SdkSessionHistoryLoader", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		getSavedApiConversationHistory.mockResolvedValue([])
	})

	it("loads and sanitizes SDK-persisted messages first", async () => {
		const reader = {
			readMessages: vi.fn().mockResolvedValue([
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "a.ts" } }],
				},
			]),
		}

		const result = await new SdkSessionHistoryLoader().loadInitialMessages(reader, "task-1")

		expect(reader.readMessages).toHaveBeenCalledWith("task-1")
		expect(getSavedApiConversationHistory).not.toHaveBeenCalled()
		expect(result).toEqual([
			expect.objectContaining({ role: "assistant" }),
			expect.objectContaining({
				role: "user",
				content: [expect.objectContaining({ type: "tool_result", tool_use_id: "toolu_1" })],
			}),
		])
	})

	it("falls back to classic API history when SDK messages are empty", async () => {
		const reader = {
			readMessages: vi.fn().mockResolvedValue([]),
		}
		getSavedApiConversationHistory.mockResolvedValue([{ role: "user", content: "hello" }])

		const result = await new SdkSessionHistoryLoader().loadInitialMessages(reader, "task-1")

		expect(getSavedApiConversationHistory).toHaveBeenCalledWith("task-1")
		expect(result).toEqual([{ role: "user", content: "hello" }])
	})

	it("falls back to classic API history when SDK reading fails", async () => {
		const reader = {
			readMessages: vi.fn().mockRejectedValue(new Error("boom")),
		}
		getSavedApiConversationHistory.mockResolvedValue([{ role: "user", content: "classic" }])

		const result = await new SdkSessionHistoryLoader().loadInitialMessages(reader, "task-1")

		expect(result).toEqual([{ role: "user", content: "classic" }])
	})

	it("returns undefined when no history exists", async () => {
		const reader = {
			readMessages: vi.fn().mockResolvedValue([]),
		}

		const result = await new SdkSessionHistoryLoader().loadInitialMessages(reader, "task-1")

		expect(result).toBeUndefined()
	})
})
