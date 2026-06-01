import type { ClineMessage } from "@shared/ExtensionMessage"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SdkTaskControlCoordinator, type SdkTaskControlCoordinatorOptions } from "./sdk-task-control-coordinator"

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
	})

	it("cancels the active session and emits a resume task ask", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })

		await coordinator.cancelTask()

		expect(options.interactions.clearPending).toHaveBeenCalledWith("Task cancelled")
		expect(activeSession.sdkHost.abort).toHaveBeenCalledWith("session-123")
		expect(options.sessions.setRunning).toHaveBeenCalledWith(false)
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ type: "ask", ask: "resume_task" })],
			{ type: "status", payload: { sessionId: "session-123", status: "cancelled" } },
		)
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})

	it("raises the cancel fence BEFORE aborting the session (so stragglers are fenced)", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })

		const order: string[] = []
		;(options.raiseCancelFence as ReturnType<typeof vi.fn>).mockImplementation(() => order.push("fence"))
		;(activeSession.sdkHost.abort as ReturnType<typeof vi.fn>).mockImplementation(async () => {
			order.push("abort")
		})

		await coordinator.cancelTask()

		expect(options.raiseCancelFence).toHaveBeenCalledOnce()
		expect(order).toEqual(["fence", "abort"])
	})

	it("clears the active session and task proxy without writing classic UI message persistence", async () => {
		const activeSession = makeActiveSession()
		const task = makeTask("task-1", [{ ts: 1, type: "say", say: "text", text: "hi", partial: true }])
		const { coordinator, options, state } = makeCoordinator({ activeSession, task })

		await coordinator.clearTask()

		expect(options.interactions.clearPending).toHaveBeenCalledWith("Task cleared")
		expect(options.sessions.endActiveSession).toHaveBeenCalledWith("clearTask")
		expect(options.messages.finalizeMessagesForSave).not.toHaveBeenCalled()
		expect(options.messages.cancelPendingSave).toHaveBeenCalledOnce()
		expect(task.messageStateHandler.clear).toHaveBeenCalledOnce()
		expect(state.task).toBeUndefined()
		expect(options.resetMessageTranslator).toHaveBeenCalledOnce()
	})

	it("shows a task by creating a proxy, loading messages, and appending a fresh resume ask", async () => {
		const existingTask = makeTask("old-task")
		const activeSession = makeActiveSession()
		const sdkClineMessages: ClineMessage[] = [
			{ ts: 1, type: "say", say: "task", text: "hello" },
			{ ts: 2, type: "ask", ask: "completion_result", text: "" },
		]
		const { coordinator, options, state } = makeCoordinator({
			activeSession,
			task: existingTask,
			hasHistoryItem: true,
			clineMessages: sdkClineMessages,
		})

		await coordinator.showTaskWithId("task-1")

		expect(options.taskHistory.findHistoryItem).toHaveBeenCalledWith("task-1")
		expect(options.sessions.endActiveSession).toHaveBeenCalledWith("showTaskWithId")
		expect(existingTask.messageStateHandler.clear).toHaveBeenCalledOnce()
		expect(options.resetMessageTranslator).toHaveBeenCalledOnce()
		expect(state.task?.taskId).toBe("task-1")
		expect(options.taskHistory.getClineMessages).toHaveBeenCalledWith("task-1")
		expect(state.task?.messageStateHandler.getClineMessages()).toEqual([
			{ ts: 1, type: "say", say: "task", text: "hello" },
			{ ts: 2, type: "ask", ask: "completion_result", text: "" },
			expect.objectContaining({ type: "ask", ask: "resume_completed_task" }),
		])
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})

	it("does not show a task that is missing from history", async () => {
		const { coordinator, options } = makeCoordinator({ hasHistoryItem: false })

		await coordinator.showTaskWithId("missing-task")

		expect(options.setTask).not.toHaveBeenCalled()
		expect(options.taskHistory.getClineMessages).not.toHaveBeenCalled()
	})

	it("does not install the new task proxy until its messages are loaded", async () => {
		const sdkClineMessages: ClineMessage[] = [
			{ ts: 1, type: "say", say: "task", text: "hello" },
			{ ts: 2, type: "ask", ask: "completion_result", text: "" },
		]

		let resolveGetClineMessages: ((messages: ClineMessage[]) => void) | undefined
		const getClineMessagesDeferred = new Promise<ClineMessage[]>((resolve) => {
			resolveGetClineMessages = resolve
		})

		const { coordinator, options, state } = makeCoordinator({
			hasHistoryItem: true,
			clineMessages: sdkClineMessages,
		})
		options.taskHistory.getClineMessages.mockReturnValueOnce(getClineMessagesDeferred)

		let setTaskHadMessages: boolean | undefined
		options.setTask.mockImplementation((task: any) => {
			setTaskHadMessages = (task?.messageStateHandler?.getClineMessages?.() ?? []).length > 0
			state.task = task
		})

		const inFlight = coordinator.showTaskWithId("task-1")

		// While getClineMessages is still pending, the new task proxy must not be
		// installed — otherwise concurrent postStateToWebview() callers would see
		// currentTaskItem.id with an empty messageStateHandler.
		await Promise.resolve()
		await Promise.resolve()
		expect(options.setTask).not.toHaveBeenCalled()
		expect(state.task).toBeUndefined()

		resolveGetClineMessages?.(sdkClineMessages)
		await inFlight

		expect(options.setTask).toHaveBeenCalledTimes(1)
		expect(setTaskHadMessages).toBe(true)
		expect(state.task?.taskId).toBe("task-1")
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})
})

function makeCoordinator(input: Partial<MakeCoordinatorInput> = {}) {
	const state: { task?: ReturnType<typeof makeTask> } = {
		task: input.task,
	}
	const options = {
		sessions: {
			getActiveSession: vi.fn(() => input.activeSession),
			endActiveSession: vi.fn().mockResolvedValue(input.activeSession),
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
			getClineMessages: vi.fn().mockResolvedValue(input.clineMessages ?? []),
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
		raiseCancelFence: vi.fn(),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
	} as unknown as SdkTaskControlCoordinatorOptions & {
		sessions: SdkTaskControlCoordinatorOptions["sessions"] & {
			getActiveSession: ReturnType<typeof vi.fn>
			endActiveSession: ReturnType<typeof vi.fn>
			setRunning: ReturnType<typeof vi.fn>
		}
		interactions: SdkTaskControlCoordinatorOptions["interactions"] & { clearPending: ReturnType<typeof vi.fn> }
		messages: SdkTaskControlCoordinatorOptions["messages"] & {
			appendAndEmit: ReturnType<typeof vi.fn>
			appendMessages: ReturnType<typeof vi.fn>
			cancelPendingSave: ReturnType<typeof vi.fn>
			finalizeMessagesForSave: ReturnType<typeof vi.fn>
		}
		taskHistory: SdkTaskControlCoordinatorOptions["taskHistory"] & {
			findHistoryItem: ReturnType<typeof vi.fn>
			getClineMessages: ReturnType<typeof vi.fn>
		}
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
	clineMessages: ClineMessage[]
}

function makeActiveSession() {
	return {
		sessionId: "session-123",
		sdkHost: {
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
