import { beforeEach, describe, expect, it, vi } from "vitest"
import { readSessionMessagesPreferringLive, SdkSessionHistoryLoader } from "./sdk-session-history-loader"
import { findSdkUserMessageIndexByOrdinal } from "./sdk-user-message-mapping"
import type { SdkSessionHost } from "./session-host"

const { getSavedApiConversationHistory } = vi.hoisted(() => ({
	getSavedApiConversationHistory: vi.fn().mockResolvedValue([]),
}))

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
		} as unknown as SdkSessionHost

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

	it("prefers the live in-memory conversation when the host exposes it", async () => {
		const liveMessages = [
			{ role: "user", content: "list the files in this folder" },
			{ role: "assistant", content: "I will list them now." },
		]
		const reader = {
			readLiveMessages: vi.fn().mockResolvedValue(liveMessages),
			readMessages: vi.fn().mockResolvedValue([]),
		} as unknown as SdkSessionHost

		const result = await new SdkSessionHistoryLoader().loadInitialMessages(reader, "task-1")

		expect(reader.readLiveMessages).toHaveBeenCalledWith("task-1")
		expect(reader.readMessages).not.toHaveBeenCalled()
		expect(result).toEqual(liveMessages)
	})

	it("falls back to classic API history when SDK messages are empty", async () => {
		const reader = {
			readMessages: vi.fn().mockResolvedValue([]),
		} as unknown as SdkSessionHost
		getSavedApiConversationHistory.mockResolvedValue([{ role: "user", content: "hello" }])

		const result = await new SdkSessionHistoryLoader().loadInitialMessages(reader, "task-1")

		expect(getSavedApiConversationHistory).toHaveBeenCalledWith("task-1")
		expect(result).toEqual([{ role: "user", content: "hello" }])
	})

	it("falls back to classic API history when SDK reading fails", async () => {
		const reader = {
			readMessages: vi.fn().mockRejectedValue(new Error("boom")),
		} as unknown as SdkSessionHost
		getSavedApiConversationHistory.mockResolvedValue([{ role: "user", content: "classic" }])

		const result = await new SdkSessionHistoryLoader().loadInitialMessages(reader, "task-1")

		expect(result).toEqual([{ role: "user", content: "classic" }])
	})

	it("returns undefined when no history exists", async () => {
		const reader = {
			readMessages: vi.fn().mockResolvedValue([]),
		} as unknown as SdkSessionHost

		const result = await new SdkSessionHistoryLoader().loadInitialMessages(reader, "task-1")

		expect(result).toBeUndefined()
	})
})

describe("readSessionMessagesPreferringLive", () => {
	const persistedDuringTurn = [
		{ role: "user", content: "add a readme" },
		{ role: "assistant", content: "added it" },
	]
	const followUp = { role: "user", content: "now add a licence too" }
	const liveDuringTurn = [...persistedDuringTurn, followUp]

	it("maps the follow-up ordinal that the persisted transcript cannot resolve yet", async () => {
		const sessionHost = {
			readLiveMessages: vi.fn().mockResolvedValue(liveDuringTurn),
			readMessages: vi.fn().mockResolvedValue(persistedDuringTurn),
		} as unknown as SdkSessionHost

		expect(findSdkUserMessageIndexByOrdinal(persistedDuringTurn, 2)).toBe(-1)

		const messages = await readSessionMessagesPreferringLive(sessionHost, "task-1")

		expect(sessionHost.readLiveMessages).toHaveBeenCalledWith("task-1")
		expect(sessionHost.readMessages).not.toHaveBeenCalled()
		expect(messages).toEqual(liveDuringTurn)
		expect(findSdkUserMessageIndexByOrdinal(messages, 2)).toBe(2)
	})

	it("falls back to the persisted conversation when the host has no live read", async () => {
		const sessionHost = {
			readMessages: vi.fn().mockResolvedValue(persistedDuringTurn),
		} as unknown as SdkSessionHost

		const messages = await readSessionMessagesPreferringLive(sessionHost, "task-1")

		expect(sessionHost.readMessages).toHaveBeenCalledWith("task-1")
		expect(messages).toEqual(persistedDuringTurn)
	})
})
