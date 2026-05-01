import type { SessionHistoryRecord } from "@clinebot/core"
import type { HistoryItem } from "@shared/HistoryItem"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { McpHub } from "@/services/mcp/McpHub"
import { sdkMessagesToClineMessages } from "./message-translator"
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
		get: vi.fn(() => ({ globalStorageFsPath: "/tmp/cline" })),
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

describe("SdkTaskHistory", () => {
	beforeEach(() => {
		vi.clearAllMocks()
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

	it("converts SDK persisted conversation messages to Cline messages", () => {
		const result = sdkMessagesToClineMessages([
			{ role: "user", content: "Build the feature" },
			{ role: "assistant", content: [{ type: "text", text: "Done" }] },
			{ role: "user", content: "Follow up" },
		])

		expect(result).toMatchObject([
			{ type: "say", say: "task", text: "Build the feature", partial: false },
			{ type: "say", say: "text", text: "Done", partial: false },
			{ type: "say", say: "user_feedback", text: "Follow up", partial: false },
		])
	})

	it("includes persisted SDK message metrics for task header pricing", () => {
		const result = sdkMessagesToClineMessages([
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

		const result = sdkMessagesToClineMessages([
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
							new_text: "## A Note from Cline\n\n> Why do programmers prefer dark mode?",
						},
					},
				],
			},
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "toolu_1", content: rawToolResult }],
			},
			{ role: "assistant", content: [{ type: "text", text: "Done!" }] },
		])

		expect(result).toMatchObject([
			{ type: "say", say: "task", text: "add a joke", partial: false },
			{ type: "say", say: "tool", partial: false },
			{ type: "say", say: "text", text: "Done!", partial: false },
		])
		expect(result.map((message) => message.text).join("\n")).not.toContain(rawToolResult)
		expect(JSON.parse(result[1].text ?? "{}")).toMatchObject({
			tool: "editedExistingFile",
			path: "/Users/maxpaulus/c/c2/README.md",
		})
	})

	it("finds a task from SDK history", async () => {
		const record = makeSessionRecord("task-1")
		const { history } = makeHistory([record])

		await expect(history.findHistoryItem("task-1")).resolves.toMatchObject({ id: "task-1", task: "task-1" })
	})

	it("returns undefined when a task is missing from SDK history", async () => {
		const { history } = makeHistory([])

		await expect(history.findHistoryItem("missing-task")).resolves.toBeUndefined()
	})

	it("updates SDK session metadata for task history changes", async () => {
		const existing = makeSessionRecord("task-1", { metadata: { existing: true } })
		const { history, updateSession } = makeHistory([existing])
		const updatedItem = makeHistoryItem("task-1", { task: "new title", tokensIn: 5, totalCost: 0.02 })

		await history.updateTaskHistory(updatedItem)

		expect(updateSession).toHaveBeenCalledWith(
			"task-1",
			expect.objectContaining({
				prompt: "new title",
				title: "new title",
				metadata: expect.objectContaining({ existing: true, title: "new title", tokensIn: 5, totalCost: 0.02 }),
			}),
		)
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
				metadata: expect.objectContaining({ tokensIn: 110, tokensOut: 220, totalCost: 0.04 }),
			}),
		)
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
			updates: { prompt?: string | null; metadata?: Record<string, unknown> | null; title?: string | null },
		) => {
			currentRecords = currentRecords.map((record) =>
				record.sessionId === sessionId
					? { ...record, prompt: updates.prompt ?? record.prompt, metadata: updates.metadata ?? record.metadata }
					: record,
			)
			return { updated: true }
		},
	)
	const deleteSession = vi.fn(async (sessionId: string) => {
		currentRecords = currentRecords.filter((record) => record.sessionId !== sessionId)
		return true
	})
	const listHistory = vi.fn(async () => currentRecords)
	const host = {
		listHistory,
		update: updateSession,
		delete: deleteSession,
	} as unknown as VscodeSessionHost
	const sessions = {
		getActiveSession: () => ({ sessionManager: host }),
	} as unknown as SdkSessionLifecycle
	const history = new SdkTaskHistory({
		mcpHub: {} as McpHub,
		sessions,
	})

	return { history, listHistory, updateSession, deleteSession }
}
