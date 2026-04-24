import type { ClineMessage } from "@shared/ExtensionMessage"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SdkTaskControlCoordinator, type SdkTaskControlCoordinatorOptions } from "./sdk-task-control-coordinator"
import { pushMessageToWebview } from "./webview-grpc-bridge"

const saveClineMessages = vi.fn().mockResolvedValue(undefined)
const getSavedClineMessages = vi.fn().mockResolvedValue([])

vi.mock("@core/storage/disk", () => ({
	getSavedClineMessages,
	saveClineMessages,
}))

vi.mock("./webview-grpc-bridge", () => ({
	pushMessageToWebview: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		debug: vi.fn(),
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}))

describe("SdkTaskControlCoordinator", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		getSavedClineMessages.mockResolvedValue([])
	})

	it("cancels the active session and emits a resume task ask", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })

		await coordinator.cancelTask()

		expect(options.interactions.clearPending).toHaveBeenCalledWith("Task cancelled")
		expect(activeSession.sessionManager.abort).toHaveBeenCalledWith("session-123")
		expect(options.sessions.setRunning).toHaveBeenCalledWith(false)
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ type: "ask", ask: "resume_task" })],
			{ type: "status", payload: { sessionId: "session-123", status: "cancelled" } },
		)
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})

	it("clears the active session and saves finalized task messages", async () => {
		const activeSession = makeActiveSession()
		const task = makeTask("task-1", [{ ts: 1, type: "say", say: "text", text: "hi", partial: true }])
		const { coordinator, options, state } = makeCoordinator({ activeSession, task })

		await coordinator.clearTask()

		expect(options.interactions.clearPending).toHaveBeenCalledWith("Task cleared")
		expect(activeSession.unsubscribe).toHaveBeenCalledOnce()
		expect(activeSession.sessionManager.stop).toHaveBeenCalledWith("session-123")
		expect(activeSession.sessionManager.dispose).toHaveBeenCalledWith("clearTask")
		expect(options.messages.finalizeMessagesForSave).toHaveBeenCalledWith(task.messageStateHandler.getClineMessages())
		expect(saveClineMessages).toHaveBeenCalledWith("task-1", [{ ts: 1, type: "say", say: "text", text: "final" }])
		expect(options.messages.cancelPendingSave).toHaveBeenCalledOnce()
		expect(task.messageStateHandler.clear).toHaveBeenCalledOnce()
		expect(state.task).toBeUndefined()
		expect(options.resetMessageTranslator).toHaveBeenCalledOnce()
	})

	it("shows a task by creating a proxy, loading messages, and appending a fresh resume ask", async () => {
		const existingTask = makeTask("old-task")
		const activeSession = makeActiveSession()
		getSavedClineMessages.mockResolvedValue([
			{ ts: 1, type: "say", say: "task", text: "hello" },
			{ ts: 2, type: "ask", ask: "completion_result", text: "" },
		])
		const { coordinator, options, state } = makeCoordinator({ activeSession, task: existingTask, hasHistoryItem: true })

		await coordinator.showTaskWithId("task-1")

		expect(options.taskHistory.findHistoryItem).toHaveBeenCalledWith("task-1")
		expect(activeSession.unsubscribe).toHaveBeenCalledOnce()
		expect(activeSession.sessionManager.stop).toHaveBeenCalledWith("session-123")
		expect(activeSession.sessionManager.dispose).toHaveBeenCalledWith("showTaskWithId")
		expect(existingTask.messageStateHandler.clear).toHaveBeenCalledOnce()
		expect(options.resetMessageTranslator).toHaveBeenCalledOnce()
		expect(state.task?.taskId).toBe("task-1")
		expect(getSavedClineMessages).toHaveBeenCalledWith("task-1")
		expect(options.messages.appendMessages).toHaveBeenCalledWith(
			[
				{ ts: 1, type: "say", say: "task", text: "hello" },
				{ ts: 2, type: "ask", ask: "completion_result", text: "" },
				expect.objectContaining({ type: "ask", ask: "resume_completed_task" }),
			],
			{ save: false },
		)
		expect(pushMessageToWebview).toHaveBeenCalledTimes(3)
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})

	it("does not show a task that is missing from history", async () => {
		const { coordinator, options } = makeCoordinator({ hasHistoryItem: false })

		await coordinator.showTaskWithId("missing-task")

		expect(options.setTask).not.toHaveBeenCalled()
		expect(getSavedClineMessages).not.toHaveBeenCalled()
	})
})

function makeCoordinator(input: Partial<MakeCoordinatorInput> = {}) {
	const state: { task?: ReturnType<typeof makeTask> } = {
		task: input.task,
	}
	const options = {
		sessions: {
			getActiveSession: vi.fn(() => input.activeSession),
			clearActiveSessionReference: vi.fn(() => input.activeSession),
			setRunning: vi.fn(),
		},
		interactions: {
			clearPending: vi.fn(),
		},
		messages: {
			appendAndEmit: vi.fn(),
			appendMessages: vi.fn(),
			cancelPendingSave: vi.fn(),
			finalizeMessagesForSave: vi.fn((messages: ClineMessage[]) =>
				messages.map((message) => {
					if (!message.partial) {
						return message
					}
					const { partial: _partial, ...rest } = message
					return { ...rest, text: "final" }
				}),
			),
		},
		taskHistory: {
			findHistoryItem: vi.fn(() =>
				input.hasHistoryItem === false
					? undefined
					: {
							id: "task-1",
							ts: 1,
							task: "hello",
							tokensIn: 0,
							tokensOut: 0,
							totalCost: 0,
						},
			),
		},
		getTask: vi.fn(() => state.task),
		setTask: vi.fn((task) => {
			state.task = task as ReturnType<typeof makeTask> | undefined
		}),
		onAskResponse: vi.fn().mockResolvedValue(undefined),
		resetMessageTranslator: vi.fn(),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
	} as unknown as SdkTaskControlCoordinatorOptions & {
		sessions: SdkTaskControlCoordinatorOptions["sessions"] & {
			getActiveSession: ReturnType<typeof vi.fn>
			clearActiveSessionReference: ReturnType<typeof vi.fn>
			setRunning: ReturnType<typeof vi.fn>
		}
		interactions: SdkTaskControlCoordinatorOptions["interactions"] & { clearPending: ReturnType<typeof vi.fn> }
		messages: SdkTaskControlCoordinatorOptions["messages"] & {
			appendAndEmit: ReturnType<typeof vi.fn>
			appendMessages: ReturnType<typeof vi.fn>
			cancelPendingSave: ReturnType<typeof vi.fn>
			finalizeMessagesForSave: ReturnType<typeof vi.fn>
		}
		taskHistory: SdkTaskControlCoordinatorOptions["taskHistory"] & { findHistoryItem: ReturnType<typeof vi.fn> }
		getTask: ReturnType<typeof vi.fn>
		setTask: ReturnType<typeof vi.fn>
		resetMessageTranslator: ReturnType<typeof vi.fn>
		postStateToWebview: ReturnType<typeof vi.fn>
	}

	return {
		coordinator: new SdkTaskControlCoordinator(options),
		options,
		state,
	}
}

interface MakeCoordinatorInput {
	activeSession: ReturnType<typeof makeActiveSession>
	task: ReturnType<typeof makeTask>
	hasHistoryItem: boolean
}

function makeActiveSession() {
	return {
		sessionId: "session-123",
		sessionManager: {
			abort: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn().mockResolvedValue(undefined),
		},
		unsubscribe: vi.fn(),
		isRunning: true,
	}
}

function makeTask(taskId: string, messages: ClineMessage[] = []) {
	return {
		taskId,
		messageStateHandler: {
			getClineMessages: vi.fn(() => messages),
			clear: vi.fn(),
		},
	}
}
