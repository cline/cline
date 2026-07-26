import type { SessionHistoryRecord } from "@bedrock-coder/core"
import type { HistoryItem } from "@shared/HistoryItem"
import getFolderSize from "get-folder-size"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { McpHub } from "@/services/mcp/McpHub"
import { sdkMessagesToBedrockCoderMessages } from "./message-translator"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import { SdkTaskHistory, sessionHistoryRecordToHistoryItem } from "./sdk-task-history"
import type { VscodeSessionHost } from "./vscode-session-host"

vi.mock("@/core/storage/disk", () => ({
	GlobalFileNames: {
		apiConversationHistory: "api_conversation_history.json",
		contextHistory: "context_history.json",
		taskMetadata: "task_metadata.json",
		uiMessages: "ui_messages.json",
	},
}))

vi.mock("@/hosts/host-provider", () => ({
	HostProvider: {
		get: vi.fn(() => ({ globalStorageFsPath: "/tmp/bedrockCoder" })),
	},
}))

vi.mock("@/utils/fs", () => ({
	fileExistsAtPath: vi.fn(() => Promise.resolve(false)),
}))

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}))

vi.mock("get-folder-size", () => ({
	default: {
		loose: vi.fn(),
	},
}))

describe("SdkTaskHistory", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(getFolderSize.loose).mockReset()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("maps SDK session history records to legacy history items", () => {
		const result = sessionHistoryRecordToHistoryItem(
			makeSessionRecord("task-1", {
				metadata: {
					title: "Build feature",
					tokensIn: 10,
					tokensOut: 20,
					totalCost: 0.01,
					isFavorited: true,
				},
				model: "claude-test",
				cwd: "/repo",
			}),
		)

		expect(result).toMatchObject({
			id: "task-1",
			task: "Build feature",
			tokensIn: 10,
			tokensOut: 20,
			totalCost: 0.01,
			isFavorited: true,
			modelId: "claude-test",
			cwdOnTaskInitialization: "/repo",
		})
		expect(result.ts).toBeGreaterThan(0)
	})

	it("converts SDK persisted conversation messages to Bedrock Coder messages", () => {
		const result = sdkMessagesToBedrockCoderMessages([
			{ role: "user", content: "Build the feature" },
			{ role: "assistant", content: [{ type: "text", text: "Done" }] },
			{ role: "user", content: "Follow up" },
		])

		expect(result).toMatchObject([
			{ type: "say", say: "task", text: "Build the feature", partial: false },
			{ type: "say", say: "text", text: "Done", partial: false },
			{ type: "say", say: "user_feedback", text: "Follow up", partial: false },
			// A trailing ask:"completion_result" is appended so a reopened task
			// shows the completion/resume affordance instead of a stuck spinner.
			{ type: "ask", ask: "completion_result", partial: false },
		])
	})

	it("includes persisted SDK message metrics for task header pricing", () => {
		const result = sdkMessagesToBedrockCoderMessages([
			{ role: "user", content: "Build the feature" },
			{
				role: "assistant",
				content: [{ type: "text", text: "Done" }],
				metrics: {
					inputTokens: 120,
					outputTokens: 30,
					cacheReadTokens: 20,
					cacheWriteTokens: 10,
					cost: 0.0123,
				},
			},
		])

		const metricsMessage = result.find((message) => message.type === "say" && message.say === "api_req_started")
		expect(metricsMessage).toBeDefined()
		expect(JSON.parse(metricsMessage?.text ?? "{}")).toMatchObject({
			tokensIn: 90,
			tokensOut: 30,
			cacheReads: 20,
			cacheWrites: 10,
			cost: 0.0123,
		})
	})

	it("renders persisted SDK tool calls as structured tool rows instead of raw tool result JSON", () => {
		const rawToolResult = JSON.stringify({
			query: "edit:/Users/maxpaulus/c/c2/README.md",
			result: "Edited /Users/maxpaulus/c/c2/README.md",
			success: true,
		})

		const result = sdkMessagesToBedrockCoderMessages([
			{ role: "user", content: "add a joke" },
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_1",
						name: "editor",
						input: {
							path: "/Users/maxpaulus/c/c2/README.md",
							old_text: "## License",
							new_text: "## A Note from Bedrock Coder\n\n> Why do programmers prefer dark mode?",
						},
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_1",
						name: "editor",
						content: rawToolResult,
					},
				],
			},
			{ role: "assistant", content: [{ type: "text", text: "Done!" }] },
		])

		expect(result).toMatchObject([
			{ type: "say", say: "task", text: "add a joke", partial: false },
			{ type: "say", say: "tool", partial: false },
			{ type: "say", say: "text", text: "Done!", partial: false },
			{ type: "ask", ask: "completion_result", partial: false },
		])
		expect(result.map((message) => message.text).join("\n")).not.toContain(rawToolResult)
		expect(JSON.parse(result[1].text ?? "{}")).toMatchObject({
			tool: "editedExistingFile",
			path: "/Users/maxpaulus/c/c2/README.md",
		})
	})

	it("hides subagent sessions from task history", async () => {
		const rootTask = makeSessionRecord("root")
		const subagent = makeSessionRecord("root__agent", {
			source: "subagent",
			isSubagent: true,
			prompt: "Inspect the SDK adapter",
		})
		const { history } = makeHistory([rootTask, subagent])

		const result = await history.listHistory()

		expect(result.map((item) => item.sessionId)).toEqual(["root"])
	})

	it("finds a task from SDK history", async () => {
		const record = makeSessionRecord("task-1")
		const { history } = makeHistory([record])

		await expect(history.findHistoryItem("task-1")).resolves.toMatchObject({
			id: "task-1",
			task: "task-1",
		})
	})

	it("backfills SDK task size from the session artifact directory", async () => {
		vi.mocked(getFolderSize.loose).mockResolvedValue(4096 as never)
		const { history, updateSession } = makeHistory([
			makeSessionRecord("task-1", {
				metadata: { title: "Build feature" },
				messagesPath: "/tmp/bedrock-coder/sessions/task-1/task-1.messages.json",
			}),
		])

		await expect(history.findHistoryItem("task-1")).resolves.toMatchObject({
			id: "task-1",
			size: 4096,
		})

		expect(getFolderSize.loose).toHaveBeenCalledWith("/tmp/bedrock-coder/sessions/task-1", { bigint: false })
		expect(updateSession).toHaveBeenCalledWith(
			"task-1",
			expect.objectContaining({
				metadata: expect.objectContaining({
					title: "Build feature",
					size: 4096,
				}),
			}),
		)
	})

	it("caches zero-byte SDK task size from the session artifact directory", async () => {
		vi.mocked(getFolderSize.loose).mockResolvedValue(0 as never)
		const { history, updateSession } = makeHistory([
			makeSessionRecord("task-1", {
				messagesPath: "/tmp/bedrock-coder/sessions/task-1/task-1.messages.json",
			}),
		])

		await expect(history.findHistoryItem("task-1")).resolves.toMatchObject({
			id: "task-1",
			size: 0,
		})
		await expect(history.findHistoryItem("task-1")).resolves.toMatchObject({
			id: "task-1",
			size: 0,
		})

		expect(getFolderSize.loose).toHaveBeenCalledTimes(1)
		expect(updateSession).toHaveBeenCalledTimes(1)
		expect(updateSession).toHaveBeenCalledWith(
			"task-1",
			expect.objectContaining({
				metadata: expect.objectContaining({ size: 0 }),
			}),
		)
	})

	it("keeps existing SDK task size metadata without measuring artifacts", async () => {
		const { history, updateSession } = makeHistory([makeSessionRecord("task-1", { metadata: { size: 2048 } })])

		await expect(history.findHistoryItem("task-1")).resolves.toMatchObject({
			id: "task-1",
			size: 2048,
		})

		expect(getFolderSize.loose).not.toHaveBeenCalled()
		expect(updateSession).not.toHaveBeenCalled()
	})

	it("returns undefined when a task is missing from SDK history", async () => {
		const { history } = makeHistory([])

		await expect(history.findHistoryItem("missing-task")).resolves.toBeUndefined()
	})

	it("updates SDK session metadata for task history changes", async () => {
		const existing = makeSessionRecord("task-1", {
			metadata: { existing: true },
		})
		const { history, getSession, listHistory, updateSession } = makeHistory([existing])
		const updatedItem = makeHistoryItem("task-1", {
			task: "new title",
			tokensIn: 5,
			totalCost: 0.02,
		})

		await history.updateTaskHistoryItem(updatedItem)

		expect(getSession).toHaveBeenCalledWith("task-1")
		expect(listHistory).not.toHaveBeenCalled()
		expect(updateSession).toHaveBeenCalledWith(
			"task-1",
			expect.objectContaining({
				prompt: "new title",
				title: "new title",
				metadata: expect.objectContaining({
					existing: true,
					title: "new title",
					tokensIn: 5,
					totalCost: 0.02,
				}),
			}),
		)
	})

	it("keeps cached SDK task size when updating history without measuring artifacts", async () => {
		vi.mocked(getFolderSize.loose).mockResolvedValue(8192 as never)
		const existing = makeSessionRecord("task-1", {
			metadata: { size: 1024 },
			messagesPath: "/tmp/bedrock-coder/sessions/task-1/task-1.messages.json",
		})
		const { history, updateSession } = makeHistory([existing])

		await history.updateTaskHistoryItem(makeHistoryItem("task-1"))

		expect(getFolderSize.loose).not.toHaveBeenCalled()
		expect(updateSession).toHaveBeenCalledWith(
			"task-1",
			expect.objectContaining({
				metadata: expect.objectContaining({ size: 1024 }),
			}),
		)
	})

	it("does not cache unavailable artifact size as zero", async () => {
		vi.mocked(getFolderSize.loose).mockRejectedValue(new Error("unreadable"))
		const existing = makeSessionRecord("task-1", {
			messagesPath: "/tmp/bedrock-coder/sessions/task-1/task-1.messages.json",
		})
		const { history, updateSession } = makeHistory([existing])

		const result = await history.findHistoryItem("task-1")

		expect(result?.size).toBeUndefined()
		expect(getFolderSize.loose).toHaveBeenCalledTimes(1)
		expect(updateSession).not.toHaveBeenCalled()
	})

	it("deletes SDK sessions", async () => {
		const { history, deleteSession } = makeHistory([makeSessionRecord("task-1")])

		await history.deleteTaskFromState("task-1")

		expect(deleteSession).toHaveBeenCalledWith("task-1")
	})

	it("updates usage for an existing SDK task", async () => {
		vi.spyOn(Date, "now").mockReturnValue(123_456)
		const { history, updateSession } = makeHistory([
			makeSessionRecord("task-1", {
				metadata: {
					tokensIn: 10,
					tokensOut: 20,
					totalCost: 0.01,
				},
			}),
		])

		await history.updateTaskUsage("task-1", {
			tokensIn: 100,
			tokensOut: 200,
			totalCost: 0.03,
		})

		expect(updateSession).toHaveBeenCalledWith(
			"task-1",
			expect.objectContaining({
				metadata: expect.objectContaining({
					tokensIn: 110,
					tokensOut: 220,
					totalCost: 0.04,
				}),
			}),
		)
	})

	it("patches cached history record in place without re-listing from host", async () => {
		const { history, listHistory } = makeHistory([
			makeSessionRecord("task-1", { updatedAt: "2026-01-01T00:00:00.000Z" }),
			makeSessionRecord("task-2", { updatedAt: "2026-01-02T00:00:00.000Z" }),
		])

		// Populate cache
		await history.listHistory({ hydrate: false })
		expect(listHistory).toHaveBeenCalledTimes(1)

		// Update task-1
		await history.updateTaskHistoryItem(makeHistoryItem("task-1", { task: "new title" }))

		// Read again — should use cache, not re-list from host
		const result = await history.listHistory({ hydrate: false })
		expect(listHistory).toHaveBeenCalledTimes(1)

		// Cached record should reflect the updated prompt and metadata
		const updated = result.find((r) => r.sessionId === "task-1")
		expect(updated?.prompt).toBe("new title")
		expect(updated?.metadata).toEqual(expect.objectContaining({ title: "new title" }))
		// updatedAt should be bumped, not the original "2026-01-01T00:00:00.000Z"
		expect(updated?.updatedAt).not.toBe("2026-01-01T00:00:00.000Z")
	})

	it("re-sorts cached history after patching so the updated record bubbles up", async () => {
		const { history } = makeHistory([
			makeSessionRecord("task-1", { updatedAt: "2026-01-01T00:00:00.000Z" }),
			makeSessionRecord("task-2", { updatedAt: "2026-01-02T00:00:00.000Z" }),
		])

		// Populate cache — task-2 (newer) should be first
		const initial = await history.listHistory({ hydrate: false })
		expect(initial[0].sessionId).toBe("task-2")
		expect(initial[1].sessionId).toBe("task-1")

		// Update task-1 with a timestamp newer than task-2
		await history.updateTaskHistoryItem(
			makeHistoryItem("task-1", { task: "updated", ts: Date.parse("2026-01-03T00:00:00.000Z") }),
		)

		// task-1 should now be first due to re-sort
		const result = await history.listHistory({ hydrate: false })
		expect(result[0].sessionId).toBe("task-1")
	})

	it("patches cache in place on per-turn usage updates", async () => {
		const { history, listHistory } = makeHistory([
			makeSessionRecord("task-1", {
				metadata: { tokensIn: 10, tokensOut: 20, totalCost: 0.01 },
			}),
		])

		// Populate cache
		await history.listHistory({ hydrate: false })
		expect(listHistory).toHaveBeenCalledTimes(1)

		// Per-turn usage update (the streaming hot path)
		await history.updateTaskUsage("task-1", {
			tokensIn: 100,
			tokensOut: 200,
			totalCost: 0.03,
		})

		// Read again — should use cache, not re-list from host
		const result = await history.listHistory({ hydrate: false })
		expect(listHistory).toHaveBeenCalledTimes(1)

		const updated = result.find((r) => r.sessionId === "task-1")
		expect(updated?.metadata).toEqual(
			expect.objectContaining({
				tokensIn: 110,
				tokensOut: 220,
				totalCost: 0.04,
			}),
		)
	})

	it("bumps cached updatedAt to the write time, not a stale HistoryItem.ts", async () => {
		// Simulates toggleTaskFavorite(), which reuses an existing HistoryItem
		// (with its original, possibly old, `ts`) to flip just `isFavorited`. The
		// persistence adapter always stamps `updatedAt` with the wall-clock write
		// time (nowIso()), so the cache patch must do the same rather than
		// deriving `updatedAt` from the stale `item.ts` — otherwise the cached
		// ordering would diverge from what's on disk until the TTL expires.
		const { history } = makeHistory([
			makeSessionRecord("task-1", { updatedAt: "2020-01-01T00:00:00.000Z" }),
			makeSessionRecord("task-2", { updatedAt: "2026-01-02T00:00:00.000Z" }),
		])

		const initial = await history.listHistory({ hydrate: false })
		expect(initial[0].sessionId).toBe("task-2")

		// Reuse task-1's original (stale) ts, as toggleTaskFavorite() does.
		await history.updateTaskHistoryItem(makeHistoryItem("task-1", { ts: Date.parse("2020-01-01T00:00:00.000Z") }))

		const result = await history.listHistory({ hydrate: false })
		const updated = result.find((r) => r.sessionId === "task-1")
		// updatedAt must reflect the write time, not the stale 2020 timestamp.
		expect(updated?.updatedAt).not.toBe("2020-01-01T00:00:00.000Z")
		expect(result[0].sessionId).toBe("task-1")
	})

	it("invalidates cache when updating a session not present in it", async () => {
		const { history, listHistory } = makeHistory([makeSessionRecord("task-1")])

		// Populate cache with just task-1
		await history.listHistory({ hydrate: false })
		expect(listHistory).toHaveBeenCalledTimes(1)

		// Update task-2, which is NOT in the cache
		await history.updateTaskHistoryItem(makeHistoryItem("task-2", { task: "new" }))

		// Next read should re-list from host (cache was invalidated)
		await history.listHistory({ hydrate: false })
		expect(listHistory).toHaveBeenCalledTimes(2)
	})

	it("invalidates rather than patches the cache when the underlying write didn't land", async () => {
		// host.update() resolves { updated: false } when the session was deleted
		// out from under the write, or an optimistic-concurrency retry was
		// exhausted by a racing writer. Patching the cache in that case would show
		// a fake "updated" record until the TTL expires.
		const { history, listHistory, updateSession } = makeHistory([
			makeSessionRecord("task-1", { prompt: "original", updatedAt: "2026-01-01T00:00:00.000Z" }),
		])

		// Populate cache
		await history.listHistory({ hydrate: false })
		expect(listHistory).toHaveBeenCalledTimes(1)

		updateSession.mockResolvedValueOnce({ updated: false })
		await history.updateTaskHistoryItem(makeHistoryItem("task-1", { task: "should not stick" }))

		// Next read should re-list from host (cache was invalidated, not patched)
		const result = await history.listHistory({ hydrate: false })
		expect(listHistory).toHaveBeenCalledTimes(2)
		// The mock's underlying store was never touched since update() bailed early,
		// so the re-listed record still shows the original prompt/updatedAt.
		const record = result.find((r) => r.sessionId === "task-1")
		expect(record?.prompt).toBe("original")
		expect(record?.updatedAt).toBe("2026-01-01T00:00:00.000Z")
	})
})

function makeHistoryItem(id: string, overrides: Partial<HistoryItem> = {}): HistoryItem {
	return {
		id,
		ts: 1,
		task: id,
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
		...overrides,
	}
}

function makeSessionRecord(id: string, overrides: Partial<SessionHistoryRecord> = {}): SessionHistoryRecord {
	return {
		sessionId: id,
		source: "vscode",
		pid: 1,
		startedAt: "2026-01-01T00:00:00.000Z",
		endedAt: null,
		exitCode: null,
		status: "completed",
		interactive: true,
		provider: "anthropic",
		model: "claude-test",
		cwd: "/repo",
		workspaceRoot: "/repo",
		enableTools: true,
		enableSpawn: true,
		enableTeams: false,
		isSubagent: false,
		prompt: id,
		metadata: {},
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	}
}

function makeHistory(records: SessionHistoryRecord[]) {
	let currentRecords = records
	const updateSession = vi.fn(
		async (
			sessionId: string,
			updates: {
				prompt?: string | null
				metadata?: Record<string, unknown> | null
				title?: string | null
			},
		) => {
			currentRecords = currentRecords.map((record) =>
				record.sessionId === sessionId
					? {
							...record,
							prompt: updates.prompt ?? record.prompt,
							metadata: updates.metadata ?? record.metadata,
						}
					: record,
			)
			return { updated: true }
		},
	)
	const deleteSession = vi.fn(async (sessionId: string) => {
		const exists = currentRecords.some((record) => record.sessionId === sessionId)
		if (!exists) {
			throw new Error(`Session not found: ${sessionId}`)
		}
		currentRecords = currentRecords.filter((record) => record.sessionId !== sessionId)
		return true
	})
	const getSession = vi.fn(async (sessionId: string) => currentRecords.find((record) => record.sessionId === sessionId))
	const listHistory = vi.fn(async () => currentRecords)
	const readMessages = vi.fn(async () => [])
	const startSession = vi.fn(async (input: { config: { sessionId?: string } }) => {
		currentRecords = [makeSessionRecord(input.config.sessionId ?? "started"), ...currentRecords]
		return { sessionId: input.config.sessionId }
	})
	const host = {
		get: getSession,
		listHistory,
		readMessages,
		start: startSession,
		update: updateSession,
		delete: deleteSession,
	} as unknown as VscodeSessionHost
	const sessions = {
		getActiveSession: () => ({ sdkHost: host }),
	} as unknown as SdkSessionLifecycle
	const history = new SdkTaskHistory({
		mcpHub: {} as McpHub,
		sessions,
	})

	return {
		history,
		getSession,
		listHistory,
		updateSession,
		deleteSession,
		readMessages,
		startSession,
	}
}
