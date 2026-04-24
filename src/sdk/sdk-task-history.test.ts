import type { HistoryItem } from "@shared/HistoryItem"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import { readTaskHistory } from "./legacy-state-reader"
import { SdkTaskHistory } from "./sdk-task-history"

vi.mock("./legacy-state-reader", () => ({
	readTaskHistory: vi.fn(() => []),
}))

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

	it("finds a task in global state before falling back to disk history", () => {
		const localItem = makeHistoryItem("local-task")
		const { manager } = makeStateManager([localItem])
		const history = new SdkTaskHistory(manager)

		expect(history.findHistoryItem("local-task")).toBe(localItem)
		expect(readTaskHistory).not.toHaveBeenCalled()
	})

	it("falls back to disk history when a task is missing from global state", () => {
		const fallbackItem = makeHistoryItem("fallback-task")
		vi.mocked(readTaskHistory).mockReturnValue([fallbackItem])
		const { manager } = makeStateManager([])
		const history = new SdkTaskHistory(manager)

		expect(history.findHistoryItem("fallback-task")).toBe(fallbackItem)
		expect(readTaskHistory).toHaveBeenCalled()
	})

	it("adds new task history items to the front of history", async () => {
		const existingItem = makeHistoryItem("existing-task")
		const newItem = makeHistoryItem("new-task")
		const { manager, state } = makeStateManager([existingItem])
		const history = new SdkTaskHistory(manager)

		await expect(history.updateTaskHistory(newItem)).resolves.toEqual([newItem, existingItem])

		expect(state.taskHistory).toEqual([newItem, existingItem])
		expect(manager.setGlobalState).toHaveBeenCalledWith("taskHistory", [newItem, existingItem])
	})

	it("replaces existing task history items in place", async () => {
		const originalItem = makeHistoryItem("task-1", { task: "old" })
		const otherItem = makeHistoryItem("task-2")
		const updatedItem = makeHistoryItem("task-1", { task: "new" })
		const { manager, state } = makeStateManager([originalItem, otherItem])
		const history = new SdkTaskHistory(manager)

		await expect(history.updateTaskHistory(updatedItem)).resolves.toEqual([updatedItem, otherItem])

		expect(state.taskHistory).toEqual([updatedItem, otherItem])
		expect(manager.setGlobalState).toHaveBeenCalledWith("taskHistory", [updatedItem, otherItem])
	})

	it("removes task history items from state", async () => {
		const taskToKeep = makeHistoryItem("keep-task")
		const taskToDelete = makeHistoryItem("delete-task")
		const { manager, state } = makeStateManager([taskToDelete, taskToKeep])
		const history = new SdkTaskHistory(manager)

		await expect(history.deleteTaskFromState("delete-task")).resolves.toEqual([taskToKeep])

		expect(state.taskHistory).toEqual([taskToKeep])
		expect(manager.setGlobalState).toHaveBeenCalledWith("taskHistory", [taskToKeep])
	})

	it("updates usage for an existing task history item", async () => {
		vi.spyOn(Date, "now").mockReturnValue(123_456)
		const item = makeHistoryItem("task-1", {
			tokensIn: 10,
			tokensOut: 20,
			totalCost: 0.01,
		})
		const { manager, state } = makeStateManager([item])
		const history = new SdkTaskHistory(manager)

		history.updateTaskUsage("task-1", {
			tokensIn: 100,
			tokensOut: 200,
			totalCost: 0.03,
		})

		await vi.waitFor(() => expect(manager.setGlobalState).toHaveBeenCalled())
		expect(state.taskHistory).toEqual([
			{
				...item,
				tokensIn: 110,
				tokensOut: 220,
				totalCost: 0.04,
				ts: 123_456,
			},
		])
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

function makeStateManager(initialHistory: HistoryItem[]) {
	const state: { taskHistory?: HistoryItem[] } = {
		taskHistory: initialHistory,
	}
	const manager = {
		getGlobalStateKey: vi.fn((key: string) => state[key as "taskHistory"]),
		setGlobalState: vi.fn(async (key: string, value: HistoryItem[]) => {
			state[key as "taskHistory"] = value
		}),
	} as unknown as StateManager & {
		getGlobalStateKey: ReturnType<typeof vi.fn>
		setGlobalState: ReturnType<typeof vi.fn>
	}

	return { manager, state }
}
