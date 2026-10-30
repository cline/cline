import { CLOUD_CREATION_UNCONFIRMED_ERROR_CODE } from "@shared/cloud/cloud-sessions"
import type { ClineMessage, TurnState } from "@shared/ExtensionMessage"
import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ClineError } from "../../../../../../src/services/error/ClineError"

// --- Mocks -------------------------------------------------------------------
// gRPC clients: record which RPC the send path chose.
const newTask = vi.fn().mockResolvedValue(undefined)
const askResponse = vi.fn().mockResolvedValue(undefined)
const cancelBackgroundCommand = vi.fn().mockResolvedValue(undefined)
const cancelTask = vi.fn().mockResolvedValue(undefined)
const clearTask = vi.fn().mockResolvedValue(undefined)
const condense = vi.fn().mockResolvedValue(undefined)
const trackIntent = vi.fn().mockResolvedValue(undefined)

vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: {
		newTask: (req: unknown) => newTask(req),
		askResponse: (req: unknown) => askResponse(req),
		cancelBackgroundCommand: (req: unknown) => cancelBackgroundCommand(req),
		cancelTask: (req: unknown) => cancelTask(req),
		clearTask: (req: unknown) => clearTask(req),
	},
	SlashServiceClient: {
		condense: (req: unknown) => condense(req),
		reportBug: vi.fn().mockResolvedValue(undefined),
	},
	UiServiceClient: {
		trackIntent: (req: unknown) => trackIntent(req),
	},
}))

// Proto request factories just echo their input so we can assert on it.
vi.mock("@shared/proto/cline/task", () => ({
	AskResponseRequest: { create: (x: unknown) => x },
	NewTaskRequest: { create: (x: unknown) => x },
}))
vi.mock("@shared/proto/cline/ui", () => ({
	IntentEvent: { create: (x: unknown) => x },
}))
vi.mock("@shared/proto/cline/common", () => ({
	EmptyRequest: { create: (x: unknown) => x },
	StringRequest: { create: (x: unknown) => x },
}))

// useExtensionState supplies turnState (+ backgroundCommandRunning, cloud target) to the hook.
let mockTurnState: TurnState | undefined
let mockCurrentCloudTask: { sessionId: string; status: "idle" } | undefined
let mockCloudTaskTarget: { target: "local" | "cloud"; repoUrl?: string; branch?: string } | undefined
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		backgroundCommandRunning: false,
		turnState: mockTurnState,
		cloudSessionsEnabled: true,
		cloudTaskTarget: mockCloudTaskTarget,
		currentCloudTask: mockCurrentCloudTask,
	}),
}))

import type { ChatState } from "../types/chatTypes"
import { useChatState } from "./useChatState"
import { useMessageHandlers } from "./useMessageHandlers"

// Minimal ChatState stub. clineAsk/lastMessage are the only derived values the send path reads.
function makeChatState(messages: ClineMessage[], overrides: Partial<ChatState> = {}): ChatState {
	const last = messages.at(-1)
	const state = {
		inputValue: "",
		setInputValue: vi.fn(),
		activeQuote: null,
		setActiveQuote: vi.fn(),
		isTextAreaFocused: false,
		setIsTextAreaFocused: vi.fn(),
		selectedImages: [],
		setSelectedImages: vi.fn(),
		selectedFiles: [],
		setSelectedFiles: vi.fn(),
		getDraftSnapshot: vi.fn(() => ({ revision: 0, text: "", activeQuote: null, images: [], files: [] })),
		consumeDraftSnapshot: vi.fn(),
		sendingDisabled: false,
		setSendingDisabled: vi.fn(),
		enableButtons: false,
		setEnableButtons: vi.fn(),
		primaryButtonText: undefined,
		setPrimaryButtonText: vi.fn(),
		secondaryButtonText: undefined,
		setSecondaryButtonText: vi.fn(),
		expandedRows: {},
		setExpandedRows: vi.fn(),
		pendingUserMessage: undefined,
		setPendingUserMessage: vi.fn(),
		pendingResponse: undefined,
		setPendingResponse: vi.fn(),
		textAreaRef: { current: null },
		lastMessage: last,
		secondLastMessage: messages.at(-2),
		clineAsk: last?.type === "ask" ? last.ask : undefined,
		task: messages.at(0),
		handleFocusChange: vi.fn(),
		clearExpandedRows: vi.fn(),
		resetState: vi.fn(),
	} as unknown as ChatState
	return { ...state, ...overrides } as ChatState
}

const completedConversation: ClineMessage[] = [
	{ ts: 1, type: "say", say: "text", text: "task" },
	{ ts: 2, type: "say", say: "completion_result", text: "all done" },
]

describe("useMessageHandlers — send routing", () => {
	beforeEach(() => {
		newTask.mockReset()
		newTask.mockResolvedValue(undefined)
		askResponse.mockReset()
		askResponse.mockResolvedValue(undefined)
		cancelBackgroundCommand.mockReset()
		cancelBackgroundCommand.mockResolvedValue(undefined)
		cancelTask.mockReset()
		cancelTask.mockResolvedValue(undefined)
		clearTask.mockReset()
		clearTask.mockResolvedValue(undefined)
		condense.mockReset()
		condense.mockResolvedValue(undefined)
		trackIntent.mockReset()
		trackIntent.mockResolvedValue(undefined)
		mockTurnState = undefined
		mockCurrentCloudTask = undefined
		mockCloudTaskTarget = undefined
	})

	it("sends a cloud request when Cloud is selected even without a repository, never a local task", async () => {
		mockCloudTaskTarget = { target: "cloud" }
		const { result } = renderHook(() => useMessageHandlers([], makeChatState([])))

		await act(async () => {
			await result.current.handleSendMessage("hello", [], ["/local/file.ts"])
		})

		expect(newTask).toHaveBeenCalledTimes(1)
		expect(newTask).toHaveBeenCalledWith(
			expect.objectContaining({ text: "hello", executionTarget: "cloud", cloudRepoUrl: undefined, files: [] }),
		)
	})

	it("sends a local request when Local is selected", async () => {
		mockCloudTaskTarget = { target: "local", repoUrl: "https://github.com/cline/fixture" }
		const { result } = renderHook(() => useMessageHandlers([], makeChatState([])))

		await act(async () => {
			await result.current.handleSendMessage("hello", [], ["/local/file.ts"])
		})

		expect(newTask).toHaveBeenCalledWith(expect.objectContaining({ text: "hello", files: ["/local/file.ts"] }))
		expect(newTask.mock.calls[0][0]).not.toHaveProperty("executionTarget")
	})

	it("routes /compact to the condense RPC instead of sending it as a message", async () => {
		mockTurnState = { phase: "completed", seq: 7 }
		const { result } = renderHook(() => useMessageHandlers(completedConversation, makeChatState(completedConversation)))

		await act(async () => {
			await result.current.handleSendMessage("/compact", [], [])
		})

		expect(condense).toHaveBeenCalledTimes(1)
		expect(condense).toHaveBeenCalledWith(expect.objectContaining({ value: "compact" }))
		expect(newTask).not.toHaveBeenCalled()
		expect(askResponse).not.toHaveBeenCalled()
		expect(trackIntent).not.toHaveBeenCalled()
	})

	it("routes the /smol alias to the condense RPC as well", async () => {
		mockTurnState = { phase: "completed", seq: 7 }
		const { result } = renderHook(() => useMessageHandlers(completedConversation, makeChatState(completedConversation)))

		await act(async () => {
			await result.current.handleSendMessage("/smol", [], [])
		})

		expect(condense).toHaveBeenCalledTimes(1)
		expect(newTask).not.toHaveBeenCalled()
		expect(askResponse).not.toHaveBeenCalled()
		expect(trackIntent).not.toHaveBeenCalled()
	})

	it("routes the /newtask alias to the condense RPC as well", async () => {
		mockTurnState = { phase: "completed", seq: 7 }
		const { result } = renderHook(() => useMessageHandlers(completedConversation, makeChatState(completedConversation)))

		await act(async () => {
			await result.current.handleSendMessage("/newtask", [], [])
		})

		expect(condense).toHaveBeenCalledTimes(1)
		expect(condense).toHaveBeenCalledWith(expect.objectContaining({ value: "compact" }))
		expect(newTask).not.toHaveBeenCalled()
		expect(askResponse).not.toHaveBeenCalled()
		expect(trackIntent).not.toHaveBeenCalled()
	})

	it("does not intercept /compact when there is no active task (starts a new task instead)", async () => {
		mockTurnState = { phase: "idle", seq: 1 }
		const { result } = renderHook(() => useMessageHandlers([], makeChatState([])))

		await act(async () => {
			await result.current.handleSendMessage("/compact", [], [])
		})

		expect(condense).not.toHaveBeenCalled()
		expect(newTask).toHaveBeenCalledTimes(1)
		expect(trackIntent).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "prompt_submitted",
				source: "chat_submit",
				hasText: true,
				hasImages: false,
				hasFiles: false,
				hasActiveTask: false,
				textLength: "/compact".length,
			}),
		)
	})

	it("after a completed turn (no clineAsk), Enter continues the conversation via askResponse — NOT newTask", async () => {
		mockTurnState = { phase: "completed", seq: 7 }
		const { result } = renderHook(() => useMessageHandlers(completedConversation, makeChatState(completedConversation)))

		await act(async () => {
			await result.current.handleSendMessage("another question", [], [])
		})

		expect(newTask).not.toHaveBeenCalled()
		expect(askResponse).toHaveBeenCalledTimes(1)
		expect(askResponse).toHaveBeenCalledWith(
			expect.objectContaining({ responseType: "messageResponse", text: "another question" }),
		)
		expect(trackIntent).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "prompt_submitted",
				source: "chat_submit",
				hasText: true,
				hasImages: false,
				hasFiles: false,
				hasActiveTask: true,
				textLength: "another question".length,
			}),
		)
	})

	it("shows pending composer state before a follow-up askResponse resolves", async () => {
		mockTurnState = { phase: "completed", seq: 7 }
		let resolveAskResponse: () => void = () => {}
		askResponse.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					resolveAskResponse = resolve
				}),
		)
		const setInputValue = vi.fn()
		const setActiveQuote = vi.fn()
		const setSendingDisabled = vi.fn()
		const setSelectedImages = vi.fn()
		const setSelectedFiles = vi.fn()
		const setEnableButtons = vi.fn()
		const setPendingUserMessage = vi.fn()
		const setPendingResponse = vi.fn()
		const chatState = makeChatState(completedConversation, {
			activeQuote: "selected context",
			sendingDisabled: false,
			enableButtons: true,
			setInputValue,
			setActiveQuote,
			setSendingDisabled,
			setSelectedImages,
			setSelectedFiles,
			setEnableButtons,
			setPendingUserMessage,
			setPendingResponse,
		})
		const { result } = renderHook(() => useMessageHandlers(completedConversation, chatState))

		let sendPromise: Promise<void> = Promise.resolve()
		await act(async () => {
			sendPromise = result.current.handleSendMessage("another question", ["image.png"], ["a.ts"])
			await Promise.resolve()
		})

		expect(askResponse).toHaveBeenCalledWith(
			expect.objectContaining({
				responseType: "messageResponse",
				text: expect.stringContaining("another question"),
				images: ["image.png"],
				files: ["a.ts"],
			}),
		)
		expect(setInputValue).toHaveBeenCalledWith("")
		expect(setActiveQuote).toHaveBeenCalledWith(null)
		expect(setSendingDisabled).toHaveBeenCalledWith(true)
		expect(setSelectedImages).toHaveBeenCalledWith([])
		expect(setSelectedFiles).toHaveBeenCalledWith([])
		expect(setEnableButtons).toHaveBeenCalledWith(false)
		expect(setPendingUserMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				afterTs: 2,
				message: expect.objectContaining({
					type: "say",
					say: "user_feedback",
					text: expect.stringContaining("another question"),
					images: ["image.png"],
					files: ["a.ts"],
					partial: false,
				}),
			}),
		)
		expect(setPendingResponse).toHaveBeenCalledWith({
			id: 1,
			turnStateSeq: 7,
			messageCount: completedConversation.length,
		})

		await act(async () => {
			resolveAskResponse()
			await sendPromise
		})
	})

	it("restores pending follow-up UI state when askResponse fails", async () => {
		mockTurnState = { phase: "completed", seq: 7 }
		const error = new Error("transport down")
		const setInputValue = vi.fn()
		const setActiveQuote = vi.fn()
		const setSendingDisabled = vi.fn()
		const setSelectedImages = vi.fn()
		const setSelectedFiles = vi.fn()
		const setEnableButtons = vi.fn()
		const setPendingUserMessage = vi.fn()
		const setPendingResponse = vi.fn()
		const chatState = makeChatState(completedConversation, {
			activeQuote: "selected context",
			sendingDisabled: false,
			enableButtons: true,
			setInputValue,
			setActiveQuote,
			setSendingDisabled,
			setSelectedImages,
			setSelectedFiles,
			setEnableButtons,
			setPendingUserMessage,
			setPendingResponse,
		})
		const { result } = renderHook(() => useMessageHandlers(completedConversation, chatState))
		askResponse.mockRejectedValueOnce(error)

		let caught: unknown
		await act(async () => {
			try {
				await result.current.handleSendMessage("another question", ["image.png"], ["a.ts"])
			} catch (err) {
				caught = err
			}
		})

		expect(caught).toBe(error)
		expect(setInputValue).toHaveBeenNthCalledWith(1, "")
		expect(setInputValue).toHaveBeenLastCalledWith("another question")
		expect(setActiveQuote).toHaveBeenNthCalledWith(1, null)
		expect(setActiveQuote).toHaveBeenLastCalledWith("selected context")
		expect(setSendingDisabled).toHaveBeenNthCalledWith(1, true)
		expect(setSendingDisabled).toHaveBeenLastCalledWith(false)
		expect(setSelectedImages).toHaveBeenNthCalledWith(1, [])
		expect(setSelectedImages).toHaveBeenLastCalledWith(["image.png"])
		expect(setSelectedFiles).toHaveBeenNthCalledWith(1, [])
		expect(setSelectedFiles).toHaveBeenLastCalledWith(["a.ts"])
		expect(setEnableButtons).toHaveBeenNthCalledWith(1, false)
		expect(setEnableButtons).toHaveBeenLastCalledWith(true)
		expect(setPendingUserMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				afterTs: 2,
				message: expect.objectContaining({
					type: "say",
					say: "user_feedback",
					text: expect.stringContaining("another question"),
				}),
			}),
		)
		const optimisticMessage = setPendingUserMessage.mock.calls[0][0]
		const rollbackMessage = setPendingUserMessage.mock.calls.at(-1)?.[0]
		expect(rollbackMessage(optimisticMessage)).toBeUndefined()
		const newerMessage = { afterTs: 3, message: { ...optimisticMessage.message, ts: 4 } }
		expect(rollbackMessage(newerMessage)).toBe(newerMessage)
		const pendingResponse = setPendingResponse.mock.calls[0][0]
		const rollbackResponse = setPendingResponse.mock.calls.at(-1)?.[0]
		expect(rollbackResponse(pendingResponse)).toBeUndefined()
		const newerResponse = { ...pendingResponse, id: 2 }
		expect(rollbackResponse(newerResponse)).toBe(newerResponse)
	})

	it.each([
		["followup", "edit"],
		["newTask", "edit"],
		["followup", "clear"],
		["followup", "unchanged"],
		["newTask", "unchanged"],
	] as const)("preserves the current draft after a failed %s with %s", async (request, action) => {
		const starting = request === "newTask"
		mockTurnState = { phase: starting ? "idle" : "completed", seq: 7 }
		mockCurrentCloudTask = starting ? undefined : { sessionId: "ses-current", status: "idle" }
		const messages = starting ? [] : completedConversation
		let rejectRequest: (error: Error) => void = () => {}
		const rpc = starting ? newTask : askResponse
		rpc.mockImplementationOnce(
			() =>
				new Promise<void>((_resolve, reject) => {
					rejectRequest = reject
				}),
		)
		const { result } = renderHook(() => {
			const chatState = useChatState(messages)
			return { chatState, handlers: useMessageHandlers(messages, chatState) }
		})
		const files = starting ? ["old.ts"] : []
		act(() => {
			result.current.chatState.setInputValue("submitted draft")
			result.current.chatState.setActiveQuote("old quote")
			result.current.chatState.setSelectedImages(["old.png"])
			result.current.chatState.setSelectedFiles(files)
			result.current.chatState.setEnableButtons(true)
		})
		let pending: Promise<void> = Promise.resolve()
		await act(async () => {
			pending = result.current.handlers.handleSendMessage("submitted draft", ["old.png"], files)
			await Promise.resolve()
		})
		expect(rpc).toHaveBeenCalledOnce()
		if (action !== "unchanged")
			act(() => {
				result.current.chatState.setInputValue("newer draft")
				result.current.chatState.setActiveQuote("new quote")
				result.current.chatState.setSelectedImages(["new.png"])
				result.current.chatState.setSelectedFiles(starting ? ["new.ts"] : [])
				if (action === "clear") result.current.chatState.resetState()
			})
		const edited = result.current.chatState.getDraftSnapshot()
		await act(async () => {
			rejectRequest(new Error("preparation failed"))
			await expect(pending).rejects.toThrow("preparation failed")
		})
		if (action === "unchanged") {
			expect(result.current.chatState.getDraftSnapshot()).toMatchObject({
				text: "submitted draft",
				activeQuote: "old quote",
				images: ["old.png"],
				files,
			})
		} else {
			expect(result.current.chatState.getDraftSnapshot()).toEqual(edited)
		}
		expect(result.current.chatState.sendingDisabled).toBe(false)
		expect(result.current.chatState.enableButtons).toBe(true)
	})

	it("does not restore an older send's flags while a newer send is pending", async () => {
		mockTurnState = { phase: "completed", seq: 7 }
		let rejectFirst: (error: Error) => void = () => {}
		let resolveSecond: () => void = () => {}
		askResponse
			.mockImplementationOnce(
				() =>
					new Promise<void>((_resolve, reject) => {
						rejectFirst = reject
					}),
			)
			.mockImplementationOnce(
				() =>
					new Promise<void>((resolve) => {
						resolveSecond = resolve
					}),
			)
		const { result, rerender } = renderHook(() => {
			const chatState = useChatState(completedConversation)
			return { chatState, handlers: useMessageHandlers(completedConversation, chatState) }
		})
		act(() => {
			result.current.chatState.setInputValue("first")
			result.current.chatState.setEnableButtons(true)
		})
		let first: Promise<void> = Promise.resolve()
		await act(async () => {
			first = result.current.handlers.handleSendMessage("first", [], [])
			await Promise.resolve()
		})
		act(() => {
			mockTurnState = { phase: "streaming", seq: 8 }
			result.current.chatState.setInputValue("second")
			rerender()
		})
		let second: Promise<void> = Promise.resolve()
		await act(async () => {
			second = result.current.handlers.handleSendMessage("second", [], [])
			await Promise.resolve()
		})
		await act(async () => {
			rejectFirst(new Error("first failed"))
			await expect(first).rejects.toThrow("first failed")
		})
		expect(result.current.chatState.inputValue).toBe("")
		expect(result.current.chatState.sendingDisabled).toBe(true)
		expect(result.current.chatState.enableButtons).toBe(false)
		await act(async () => {
			resolveSecond()
			await second
		})
	})

	it.each([
		false,
		true,
	])("does not restore a rejected cloud follow-up draft after a cloud task switch (back to origin: %s)", async (switchBackToOrigin) => {
		mockTurnState = { phase: "completed", seq: 7 }
		mockCurrentCloudTask = { sessionId: "ses-task-a", status: "idle" }
		let rejectAskResponse: (error: Error) => void = () => {}
		askResponse.mockImplementationOnce(
			() =>
				new Promise<void>((_resolve, reject) => {
					rejectAskResponse = reject
				}),
		)
		const taskA = completedConversation
		const taskB: ClineMessage[] = [
			{ ts: 3, type: "say", say: "text", text: "task B" },
			{ ts: 4, type: "say", say: "completion_result", text: "all done" },
		]
		const { result, rerender } = renderHook(
			({ messages }: { messages: ClineMessage[] }) => {
				const chatState = useChatState(messages)
				return { chatState, handlers: useMessageHandlers(messages, chatState) }
			},
			{ initialProps: { messages: taskA } },
		)

		act(() => {
			result.current.chatState.setInputValue("draft for task A")
			result.current.chatState.setActiveQuote("quote A")
			result.current.chatState.setSelectedImages(["image-A.png"])
			result.current.chatState.setSelectedFiles(["file-A.ts"])
		})

		let sendA!: Promise<void>
		await act(async () => {
			sendA = result.current.handlers.handleSendMessage("draft for task A", ["image-A.png"], ["file-A.ts"])
			await Promise.resolve()
		})

		await act(async () => {
			mockCurrentCloudTask = { sessionId: "ses-task-b", status: "idle" }
			rerender({ messages: taskB })
		})
		if (switchBackToOrigin) {
			await act(async () => {
				mockCurrentCloudTask = { sessionId: "ses-task-a", status: "idle" }
				rerender({ messages: taskA })
			})
		}
		act(() => {
			result.current.chatState.setInputValue("draft for current task")
			result.current.chatState.setActiveQuote("quote current")
			result.current.chatState.setSelectedImages(["image-current.png"])
			result.current.chatState.setSelectedFiles(["file-current.ts"])
		})

		await act(async () => {
			rejectAskResponse(new Error("cloud preparation failed"))
			await sendA.catch(() => undefined)
		})

		expect(result.current.chatState.inputValue).toBe("draft for current task")
		expect(result.current.chatState.activeQuote).toBe("quote current")
		expect(result.current.chatState.selectedImages).toEqual(["image-current.png"])
		expect(result.current.chatState.selectedFiles).toEqual(["file-current.ts"])
	})

	it("shows a pending chat bubble immediately when sending a message to a task resumed from history", async () => {
		mockTurnState = { phase: "resumable", seq: 5 }
		const historyConversation: ClineMessage[] = [
			{ ts: 1, type: "say", say: "task", text: "task" },
			{ ts: 2, type: "say", say: "text", text: "partial work" },
			{ ts: 3, type: "ask", ask: "resume_task" },
		]
		const setPendingUserMessage = vi.fn()
		const setPendingResponse = vi.fn()
		const { result } = renderHook(() =>
			useMessageHandlers(
				historyConversation,
				makeChatState(historyConversation, { setPendingUserMessage, setPendingResponse }),
			),
		)

		await act(async () => {
			await result.current.handleSendMessage("keep going", ["image.png"], ["a.ts"])
		})

		expect(newTask).not.toHaveBeenCalled()
		expect(askResponse).toHaveBeenCalledTimes(1)
		expect(askResponse).toHaveBeenCalledWith(
			expect.objectContaining({
				responseType: "yesButtonClicked",
				text: "keep going",
				images: ["image.png"],
				files: ["a.ts"],
			}),
		)
		expect(setPendingUserMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				afterTs: 3,
				message: expect.objectContaining({
					type: "say",
					say: "user_feedback",
					text: "keep going",
					images: ["image.png"],
					files: ["a.ts"],
					partial: false,
				}),
			}),
		)
		expect(setPendingResponse).toHaveBeenCalledWith({
			id: 1,
			turnStateSeq: 5,
			messageCount: historyConversation.length,
		})
	})

	it("shows a pending chat bubble when resuming a completed task from history", async () => {
		mockTurnState = { phase: "completed", seq: 4 }
		const historyConversation: ClineMessage[] = [
			{ ts: 1, type: "say", say: "task", text: "task" },
			{ ts: 2, type: "say", say: "completion_result", text: "all done" },
			{ ts: 3, type: "ask", ask: "resume_completed_task" },
		]
		const setPendingUserMessage = vi.fn()
		const { result } = renderHook(() =>
			useMessageHandlers(historyConversation, makeChatState(historyConversation, { setPendingUserMessage })),
		)

		await act(async () => {
			await result.current.handleSendMessage("one more thing", [], [])
		})

		expect(askResponse).toHaveBeenCalledWith(
			expect.objectContaining({ responseType: "yesButtonClicked", text: "one more thing" }),
		)
		expect(setPendingUserMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				afterTs: 3,
				message: expect.objectContaining({ say: "user_feedback", text: "one more thing" }),
			}),
		)
	})

	it("does not show a pending chat bubble for a streaming follow-up that will be queued", async () => {
		mockTurnState = { phase: "streaming", seq: 9 }
		const streamingConversation: ClineMessage[] = [
			{ ts: 1, type: "say", say: "task", text: "task" },
			{ ts: 2, type: "say", say: "text", text: "working", partial: true },
		]
		const setPendingUserMessage = vi.fn()
		const setPendingResponse = vi.fn()
		const { result } = renderHook(() =>
			useMessageHandlers(
				streamingConversation,
				makeChatState(streamingConversation, { setPendingUserMessage, setPendingResponse }),
			),
		)

		await act(async () => {
			await result.current.handleSendMessage("steer this way", [], [])
		})

		expect(askResponse).toHaveBeenCalledTimes(1)
		expect(setPendingUserMessage).not.toHaveBeenCalled()
		expect(setPendingResponse).not.toHaveBeenCalled()
	})

	it("rejects a pending approval when the composer is submitted with typed feedback", async () => {
		mockTurnState = { phase: "awaiting_approval", anchorTs: 2, seq: 9 }
		const approvalConversation: ClineMessage[] = [
			{ ts: 1, type: "say", say: "task", text: "task" },
			{ ts: 2, type: "ask", ask: "tool", text: JSON.stringify({ tool: "newFileCreated", path: "notes.txt" }) },
		]
		const setPendingUserMessage = vi.fn()
		const { result } = renderHook(() =>
			useMessageHandlers(approvalConversation, makeChatState(approvalConversation, { setPendingUserMessage })),
		)

		await act(async () => {
			await result.current.handleSendMessage("use a different filename", ["image.png"], ["notes.txt"])
		})

		expect(newTask).not.toHaveBeenCalled()
		expect(condense).not.toHaveBeenCalled()
		expect(askResponse).toHaveBeenCalledTimes(1)
		expect(askResponse).toHaveBeenCalledWith(
			expect.objectContaining({
				responseType: "noButtonClicked",
				text: "use a different filename",
				images: ["image.png"],
				files: ["notes.txt"],
			}),
		)
		expect(askResponse).not.toHaveBeenCalledWith(expect.objectContaining({ responseType: "messageResponse" }))
		expect(setPendingUserMessage).not.toHaveBeenCalled()
	})

	it("phase awaiting_followup also routes a follow-up to askResponse", async () => {
		mockTurnState = { phase: "awaiting_followup", seq: 3 }
		const setPendingResponse = vi.fn()
		const { result } = renderHook(() =>
			useMessageHandlers(completedConversation, makeChatState(completedConversation, { setPendingResponse })),
		)

		await act(async () => {
			await result.current.handleSendMessage("more info", [], [])
		})

		expect(newTask).not.toHaveBeenCalled()
		expect(askResponse).toHaveBeenCalledTimes(1)
		expect(setPendingResponse).toHaveBeenCalledWith({
			id: 1,
			turnStateSeq: 3,
			messageCount: completedConversation.length,
		})
	})

	it("disables recovery for an unconfirmed cloud creation but still clears it for New Task", async () => {
		mockTurnState = { phase: "error", anchorTs: 2, seq: 4 }
		const conversation: ClineMessage[] = [
			{ ts: 1, type: "say", say: "task", text: "task" },
			{
				ts: 2,
				type: "ask",
				ask: "api_req_failed",
				text: new ClineError({
					message: "Check History before starting another cloud task.",
					code: CLOUD_CREATION_UNCONFIRMED_ERROR_CODE,
				}).serialize(),
			},
		]
		const { result } = renderHook(() => useMessageHandlers(conversation, makeChatState(conversation)))
		expect(result.current.errorRecoveryAvailable).toBe(false)
		await act(async () => {
			await result.current.startNewTask()
		})
		expect(clearTask).toHaveBeenCalledOnce()
		expect(askResponse).not.toHaveBeenCalled()
		expect(newTask).not.toHaveBeenCalled()
	})

	it("submits a new prompt instead of retrying the failed prompt from the error state", async () => {
		mockTurnState = { phase: "error", anchorTs: 2, seq: 4 }
		const failedConversation: ClineMessage[] = [
			{ ts: 1, type: "say", say: "task", text: "task" },
			{ ts: 2, type: "ask", ask: "api_req_failed", text: "provider unavailable" },
		]
		const setPendingUserMessage = vi.fn()
		const consumeDraftSnapshot = vi.fn()
		const draft = {
			revision: 4,
			text: "try a different approach",
			activeQuote: null,
			images: ["image.png"],
			files: ["notes.txt"],
		}
		const { result } = renderHook(() =>
			useMessageHandlers(
				failedConversation,
				makeChatState(failedConversation, {
					consumeDraftSnapshot,
					getDraftSnapshot: () => draft,
					setPendingUserMessage,
				}),
			),
		)

		await act(async () => {
			await result.current.handleSendMessage("try a different approach", ["image.png"], ["notes.txt"])
		})

		expect(askResponse).toHaveBeenCalledTimes(1)
		expect(askResponse).toHaveBeenCalledWith({
			responseType: "messageResponse",
			text: "try a different approach",
			images: ["image.png"],
			files: ["notes.txt"],
		})
		expect(askResponse).not.toHaveBeenCalledWith(expect.objectContaining({ responseType: "yesButtonClicked" }))
		expect(setPendingUserMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				afterTs: 2,
				message: expect.objectContaining({ say: "user_feedback", text: "try a different approach" }),
			}),
		)
		expect(consumeDraftSnapshot).toHaveBeenCalledWith(draft)
	})

	it("lets the first recovery action claim the failed turn", async () => {
		mockTurnState = { phase: "error", anchorTs: 2, seq: 4 }
		const failedConversation: ClineMessage[] = [
			{ ts: 1, type: "say", say: "task", text: "task" },
			{ ts: 2, type: "ask", ask: "api_req_failed", text: "provider unavailable" },
		]
		let resolveAskResponse: () => void = () => {}
		askResponse.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					resolveAskResponse = resolve
				}),
		)
		const { result } = renderHook(() => {
			const chatState = useChatState(failedConversation)
			return { chatState, handlers: useMessageHandlers(failedConversation, chatState) }
		})
		act(() => result.current.chatState.setInputValue("try a different approach"))

		let sendPromise: Promise<void> = Promise.resolve()
		await act(async () => {
			sendPromise = result.current.handlers.handleSendMessage("try a different approach", [], [])
			await Promise.resolve()
		})
		expect(result.current.handlers.recoveryActionInFlight).toBe(true)

		await act(async () => {
			await result.current.handlers.executeButtonAction({ type: "retry" })
		})
		expect(askResponse).toHaveBeenCalledTimes(1)
		expect(askResponse).toHaveBeenCalledWith(
			expect.objectContaining({ responseType: "messageResponse", text: "try a different approach" }),
		)

		await act(async () => {
			resolveAskResponse()
			await sendPromise
		})
	})

	it("uses the anchored API error when a status message trails it", async () => {
		mockTurnState = { phase: "error", anchorTs: 2, seq: 4 }
		const failedConversation: ClineMessage[] = [
			{ ts: 1, type: "say", say: "task", text: "task" },
			{ ts: 2, type: "ask", ask: "api_req_failed", text: "provider unavailable" },
			{ ts: 3, type: "say", say: "subagent_usage", text: "bookkeeping" },
		]
		let resolveAskResponse: () => void = () => {}
		askResponse.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					resolveAskResponse = resolve
				}),
		)
		const { result } = renderHook(() => {
			const chatState = useChatState(failedConversation)
			return { chatState, handlers: useMessageHandlers(failedConversation, chatState) }
		})
		act(() => result.current.chatState.setInputValue("try a different approach"))
		expect(result.current.handlers.errorRecoveryAvailable).toBe(true)

		let sendPromise: Promise<void> = Promise.resolve()
		await act(async () => {
			sendPromise = result.current.handlers.handleSendMessage("try a different approach", [], [])
			await Promise.resolve()
		})
		await act(async () => {
			await result.current.handlers.executeButtonAction({ type: "retry" })
		})

		expect(askResponse).toHaveBeenCalledTimes(1)
		expect(askResponse).toHaveBeenCalledWith(
			expect.objectContaining({ responseType: "messageResponse", text: "try a different approach" }),
		)
		await act(async () => {
			resolveAskResponse()
			await sendPromise
		})
	})

	it("blocks composer submission after Retry claims the failed turn", async () => {
		mockTurnState = { phase: "error", anchorTs: 2, seq: 4 }
		const failedConversation: ClineMessage[] = [
			{ ts: 1, type: "say", say: "task", text: "task" },
			{ ts: 2, type: "ask", ask: "api_req_failed", text: "provider unavailable" },
		]
		let resolveAskResponse: () => void = () => {}
		askResponse.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					resolveAskResponse = resolve
				}),
		)
		const { result } = renderHook(() => {
			const chatState = useChatState(failedConversation)
			return { chatState, handlers: useMessageHandlers(failedConversation, chatState) }
		})
		act(() => result.current.chatState.setInputValue("try a different approach"))

		let retryPromise: Promise<void> = Promise.resolve()
		await act(async () => {
			retryPromise = result.current.handlers.executeButtonAction({ type: "retry" })
			await Promise.resolve()
		})
		expect(result.current.handlers.recoveryActionInFlight).toBe(true)

		await act(async () => {
			await result.current.handlers.handleSendMessage("try a different approach", [], [])
		})
		expect(askResponse).toHaveBeenCalledTimes(1)
		expect(askResponse).toHaveBeenCalledWith({ responseType: "yesButtonClicked" })

		await act(async () => {
			resolveAskResponse()
			await retryPromise
		})
	})

	it("blocks composer submission after Start New Task claims the failed turn", async () => {
		mockTurnState = { phase: "error", anchorTs: 2, seq: 4 }
		const failedConversation: ClineMessage[] = [
			{ ts: 1, type: "say", say: "task", text: "task" },
			{ ts: 2, type: "ask", ask: "api_req_failed", text: "provider unavailable" },
		]
		let resolveClearTask: () => void = () => {}
		clearTask.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					resolveClearTask = resolve
				}),
		)
		const { result } = renderHook(() => {
			const chatState = useChatState(failedConversation)
			return { chatState, handlers: useMessageHandlers(failedConversation, chatState) }
		})
		act(() => result.current.chatState.setInputValue("try a different approach"))

		let newTaskPromise: Promise<void> = Promise.resolve()
		await act(async () => {
			newTaskPromise = result.current.handlers.executeButtonAction({ type: "new_task" })
			await Promise.resolve()
		})

		await act(async () => {
			await result.current.handlers.handleSendMessage("try a different approach", [], [])
		})
		expect(clearTask).toHaveBeenCalledTimes(1)
		expect(askResponse).not.toHaveBeenCalled()

		await act(async () => {
			resolveClearTask()
			await newTaskPromise
		})
	})

	it("rejects task compaction while API error recovery is available", async () => {
		mockTurnState = { phase: "error", anchorTs: 2, seq: 4 }
		const failedConversation: ClineMessage[] = [
			{ ts: 1, type: "say", say: "task", text: "task" },
			{ ts: 2, type: "ask", ask: "api_req_failed", text: "provider unavailable" },
		]
		const { result } = renderHook(() => useMessageHandlers(failedConversation, makeChatState(failedConversation)))

		await expect(result.current.compactTask()).resolves.toBe(false)

		expect(condense).not.toHaveBeenCalled()
	})

	it("keeps a typed /compact in the composer during API error recovery instead of sending it as text", async () => {
		mockTurnState = { phase: "error", anchorTs: 2, seq: 4 }
		const failedConversation: ClineMessage[] = [
			{ ts: 1, type: "say", say: "task", text: "task" },
			{ ts: 2, type: "ask", ask: "api_req_failed", text: "provider unavailable" },
		]
		const { result } = renderHook(() => {
			const chatState = useChatState(failedConversation)
			return { chatState, handlers: useMessageHandlers(failedConversation, chatState) }
		})
		act(() => result.current.chatState.setInputValue("/compact"))

		await act(async () => {
			await result.current.handlers.handleSendMessage("/compact", [], [])
		})

		expect(condense).not.toHaveBeenCalled()
		expect(askResponse).not.toHaveBeenCalled()
		expect(result.current.chatState.inputValue).toBe("/compact")
		expect(result.current.handlers.recoveryActionInFlight).toBe(false)
	})

	it("offers recovery for a provider failure that reaches the error phase without an anchor", async () => {
		mockTurnState = { phase: "error", seq: 4 }
		const failedConversation: ClineMessage[] = [
			{ ts: 1, type: "say", say: "task", text: "task" },
			{ ts: 2, type: "say", say: "error", text: "Agent error: provider unavailable" },
		]
		let resolveAskResponse: () => void = () => {}
		askResponse.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					resolveAskResponse = resolve
				}),
		)
		const { result } = renderHook(() => {
			const chatState = useChatState(failedConversation)
			return { chatState, handlers: useMessageHandlers(failedConversation, chatState) }
		})
		expect(result.current.handlers.errorRecoveryAvailable).toBe(true)
		act(() => result.current.chatState.setInputValue("try a different approach"))

		let sendPromise: Promise<void> = Promise.resolve()
		await act(async () => {
			sendPromise = result.current.handlers.handleSendMessage("try a different approach", [], [])
			await Promise.resolve()
		})
		expect(result.current.handlers.recoveryActionInFlight).toBe(true)

		await act(async () => {
			await expect(result.current.handlers.executeButtonAction({ type: "retry" })).resolves.toBe(false)
		})
		expect(askResponse).toHaveBeenCalledTimes(1)
		expect(askResponse).toHaveBeenCalledWith(
			expect.objectContaining({ responseType: "messageResponse", text: "try a different approach" }),
		)

		await act(async () => {
			resolveAskResponse()
			await sendPromise
		})
	})

	it("does not treat the mistake limit as API error recovery", () => {
		mockTurnState = { phase: "error", anchorTs: 2, seq: 4 }
		const conversation: ClineMessage[] = [
			{ ts: 1, type: "say", say: "task", text: "task" },
			{ ts: 2, type: "ask", ask: "mistake_limit_reached", text: "" },
		]
		const { result } = renderHook(() => useMessageHandlers(conversation, makeChatState(conversation)))

		expect(result.current.errorRecoveryAvailable).toBe(false)
	})

	it("reports that a duplicate cancellation did not start", async () => {
		mockTurnState = { phase: "streaming", seq: 4 }
		let resolveCancelTask: () => void = () => {}
		cancelTask.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					resolveCancelTask = resolve
				}),
		)
		const { result } = renderHook(() => useMessageHandlers(completedConversation, makeChatState(completedConversation)))

		let firstCancel: Promise<boolean> = Promise.resolve(false)
		await act(async () => {
			firstCancel = result.current.executeButtonAction({ type: "cancel" })
			await Promise.resolve()
		})

		await expect(result.current.executeButtonAction({ type: "cancel" })).resolves.toBe(false)
		expect(cancelTask).toHaveBeenCalledTimes(1)

		await act(async () => {
			resolveCancelTask()
			await expect(firstCancel).resolves.toBe(true)
		})
	})

	it("attributes a navbar new-task transition to the navbar", async () => {
		mockTurnState = { phase: "completed", seq: 4 }
		const { result } = renderHook(() => useMessageHandlers(completedConversation, makeChatState(completedConversation)))

		await act(async () => {
			await result.current.startNewTask("navbar")
		})

		expect(clearTask).toHaveBeenCalledTimes(1)
		expect(trackIntent).toHaveBeenCalledWith(expect.objectContaining({ action: "new_task_clicked", source: "navbar" }))
	})

	it("keeps a draft typed while a new task's RPC is still pending", async () => {
		mockTurnState = { phase: "idle", seq: 1 }
		let resolveNewTask: () => void = () => {}
		newTask.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					resolveNewTask = resolve
				}),
		)
		const { result } = renderHook(() => {
			const chatState = useChatState([])
			return { chatState, handlers: useMessageHandlers([], chatState) }
		})
		act(() => result.current.chatState.setInputValue("start a task"))

		let sendPromise: Promise<void> = Promise.resolve()
		await act(async () => {
			sendPromise = result.current.handlers.handleSendMessage("start a task", [], [])
			await Promise.resolve()
		})
		expect(result.current.chatState.inputValue).toBe("")
		// The composer disables submit while the task provisions, so the draft stays in the input.
		act(() => result.current.chatState.setInputValue("follow up"))

		await act(async () => {
			resolveNewTask()
			await sendPromise
		})
		expect(result.current.chatState.inputValue).toBe("follow up")
	})

	it("preserves edits made while a recovery response succeeds", async () => {
		mockTurnState = { phase: "error", anchorTs: 2, seq: 4 }
		const failedConversation: ClineMessage[] = [
			{ ts: 1, type: "say", say: "task", text: "task" },
			{ ts: 2, type: "ask", ask: "api_req_failed", text: "provider unavailable" },
		]
		let resolveAskResponse: () => void = () => {}
		askResponse.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					resolveAskResponse = resolve
				}),
		)
		const { result } = renderHook(() => {
			const chatState = useChatState(failedConversation)
			return { chatState, handlers: useMessageHandlers(failedConversation, chatState) }
		})
		act(() => result.current.chatState.setInputValue("submitted draft"))

		let sendPromise: Promise<void> = Promise.resolve()
		await act(async () => {
			sendPromise = result.current.handlers.handleSendMessage("submitted draft", [], [])
			await Promise.resolve()
		})
		act(() => {
			result.current.chatState.setInputValue("newer draft")
			result.current.chatState.setSelectedFiles(["newer.md"])
		})

		await act(async () => {
			resolveAskResponse()
			await sendPromise
		})
		expect(result.current.chatState.inputValue).toBe("newer draft")
		expect(result.current.chatState.selectedFiles).toEqual(["newer.md"])
	})

	it("preserves edits and releases the claim when a recovery response fails", async () => {
		mockTurnState = { phase: "error", anchorTs: 2, seq: 4 }
		const failedConversation: ClineMessage[] = [
			{ ts: 1, type: "say", say: "task", text: "task" },
			{ ts: 2, type: "ask", ask: "api_req_failed", text: "provider unavailable" },
		]
		let rejectAskResponse: (error: Error) => void = () => {}
		askResponse.mockImplementationOnce(
			() =>
				new Promise<void>((_resolve, reject) => {
					rejectAskResponse = reject
				}),
		)
		const { result } = renderHook(() => {
			const chatState = useChatState(failedConversation)
			return { chatState, handlers: useMessageHandlers(failedConversation, chatState) }
		})
		act(() => result.current.chatState.setInputValue("submitted draft"))

		let sendPromise: Promise<void> = Promise.resolve()
		await act(async () => {
			sendPromise = result.current.handlers.handleSendMessage("submitted draft", [], [])
			await Promise.resolve()
		})
		act(() => result.current.chatState.setInputValue("newer draft"))

		await act(async () => {
			rejectAskResponse(new Error("transport down"))
			await expect(sendPromise).rejects.toThrow("transport down")
		})
		expect(result.current.chatState.inputValue).toBe("newer draft")
		expect(result.current.handlers.recoveryActionInFlight).toBe(false)
	})

	it("does not show a pending chat bubble when answering an active follow-up question with freeform text", async () => {
		mockTurnState = { phase: "awaiting_followup", anchorTs: 2, seq: 3 }
		const questionConversation: ClineMessage[] = [
			{ ts: 1, type: "say", say: "task", text: "task" },
			{
				ts: 2,
				type: "ask",
				ask: "followup",
				text: JSON.stringify({ question: "Which approach?", options: ["A", "B"] }),
			},
		]
		const setPendingUserMessage = vi.fn()
		const { result } = renderHook(() =>
			useMessageHandlers(questionConversation, makeChatState(questionConversation, { setPendingUserMessage })),
		)

		await act(async () => {
			await result.current.handleSendMessage("something else", [], [])
		})

		expect(askResponse).toHaveBeenCalledTimes(1)
		expect(askResponse).toHaveBeenCalledWith(
			expect.objectContaining({ responseType: "messageResponse", text: "something else" }),
		)
		expect(setPendingUserMessage).not.toHaveBeenCalled()
	})

	it("an empty transcript still starts a NEW task (unchanged behavior)", async () => {
		mockTurnState = { phase: "idle", seq: 1 }
		const setPendingUserMessage = vi.fn()
		const setPendingResponse = vi.fn()
		const { result } = renderHook(() =>
			useMessageHandlers([], makeChatState([], { setPendingUserMessage, setPendingResponse })),
		)

		await act(async () => {
			await result.current.handleSendMessage("brand new task", [], [])
		})

		expect(newTask).toHaveBeenCalledTimes(1)
		expect(askResponse).not.toHaveBeenCalled()
		expect(setPendingResponse).toHaveBeenCalledWith({ id: 1, turnStateSeq: 1, messageCount: 0 })
		expect(setPendingUserMessage).toHaveBeenCalledWith({
			afterTs: 0,
			message: expect.objectContaining({
				type: "say",
				say: "task",
				text: "brand new task",
				partial: false,
			}),
		})
		expect(trackIntent).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "prompt_submitted",
				source: "chat_submit",
				hasText: true,
				hasImages: false,
				hasFiles: false,
				hasActiveTask: false,
				textLength: "brand new task".length,
			}),
		)
	})

	it("restores pending new-task UI state when the RPC fails", async () => {
		mockTurnState = { phase: "idle", seq: 1 }
		const error = new Error("transport down")
		const setInputValue = vi.fn()
		const setActiveQuote = vi.fn()
		const setSendingDisabled = vi.fn()
		const setSelectedImages = vi.fn()
		const setSelectedFiles = vi.fn()
		const setEnableButtons = vi.fn()
		const setPendingUserMessage = vi.fn()
		const setPendingResponse = vi.fn()
		const chatState = makeChatState([], {
			activeQuote: "selected context",
			sendingDisabled: false,
			enableButtons: true,
			setInputValue,
			setActiveQuote,
			setSendingDisabled,
			setSelectedImages,
			setSelectedFiles,
			setEnableButtons,
			setPendingUserMessage,
			setPendingResponse,
		})
		const { result } = renderHook(() => useMessageHandlers([], chatState))
		newTask.mockRejectedValueOnce(error)

		let caught: unknown
		await act(async () => {
			try {
				await result.current.handleSendMessage("brand new task", ["image.png"], ["a.ts"])
			} catch (err) {
				caught = err
			}
		})

		expect(caught).toBe(error)
		expect(newTask).toHaveBeenCalledWith(
			expect.objectContaining({
				text: expect.stringContaining("selected context"),
				images: ["image.png"],
				files: ["a.ts"],
			}),
		)
		expect(setInputValue).toHaveBeenNthCalledWith(1, "")
		expect(setInputValue).toHaveBeenLastCalledWith("brand new task")
		expect(setActiveQuote).toHaveBeenNthCalledWith(1, null)
		expect(setActiveQuote).toHaveBeenLastCalledWith("selected context")
		expect(setSendingDisabled).toHaveBeenNthCalledWith(1, true)
		expect(setSendingDisabled).toHaveBeenLastCalledWith(false)
		expect(setSelectedImages).toHaveBeenNthCalledWith(1, [])
		expect(setSelectedImages).toHaveBeenLastCalledWith(["image.png"])
		expect(setSelectedFiles).toHaveBeenNthCalledWith(1, [])
		expect(setSelectedFiles).toHaveBeenLastCalledWith(["a.ts"])
		expect(setEnableButtons).toHaveBeenNthCalledWith(1, false)
		expect(setEnableButtons).toHaveBeenLastCalledWith(true)
		const optimisticMessage = setPendingUserMessage.mock.calls[0][0]
		const rollbackMessage = setPendingUserMessage.mock.calls.at(-1)?.[0]
		expect(rollbackMessage(optimisticMessage)).toBeUndefined()
		const pendingResponse = setPendingResponse.mock.calls[0][0]
		const rollbackResponse = setPendingResponse.mock.calls.at(-1)?.[0]
		expect(rollbackResponse(pendingResponse)).toBeUndefined()
	})

	it("startNewTask drops any unconfirmed optimistic message so it cannot be re-injected after clearTask", async () => {
		mockTurnState = { phase: "streaming", seq: 2 }
		const streamingConversation: ClineMessage[] = [
			{ ts: 1, type: "say", say: "task", text: "task with attachment" },
			{ ts: 2, type: "say", say: "text", text: "working", partial: true },
		]
		const setPendingUserMessage = vi.fn()
		const setPendingResponse = vi.fn()
		const setActiveQuote = vi.fn()
		const { result } = renderHook(() =>
			useMessageHandlers(
				streamingConversation,
				makeChatState(streamingConversation, { setActiveQuote, setPendingUserMessage, setPendingResponse }),
			),
		)

		await act(async () => {
			await result.current.startNewTask()
		})

		expect(clearTask).toHaveBeenCalledTimes(1)
		expect(setPendingUserMessage).toHaveBeenCalledWith(undefined)
		expect(setPendingResponse).toHaveBeenCalledWith(undefined)
		expect(setActiveQuote).toHaveBeenCalledWith(null)
	})

	it("does not clear a quote selected while New Task is pending", async () => {
		mockTurnState = { phase: "awaiting_followup", anchorTs: 2, seq: 3 }
		const newTaskConversation: ClineMessage[] = [
			{ ts: 1, type: "say", say: "task", text: "task" },
			{ ts: 2, type: "ask", ask: "new_task", text: "new task context" },
		]
		let resolveNewTask: (() => void) | undefined
		newTask.mockImplementationOnce(() => new Promise<void>((resolve) => (resolveNewTask = resolve)))
		const { result } = renderHook(() => {
			const chatState = useChatState(newTaskConversation)
			return { chatState, handlers: useMessageHandlers(newTaskConversation, chatState) }
		})
		act(() => result.current.chatState.setActiveQuote("old task quote"))

		let action: Promise<void> | undefined
		act(() => {
			action = result.current.handlers.executeButtonAction({ type: "new_task" })
		})
		act(() => result.current.chatState.setActiveQuote("new draft quote"))
		await act(async () => {
			resolveNewTask?.()
			await action
		})

		expect(result.current.chatState.activeQuote).toBe("new draft quote")
	})

	it("retries a failed request without changing the unsent draft", async () => {
		mockTurnState = { phase: "error", anchorTs: 2, seq: 3 }
		const failedConversation: ClineMessage[] = [
			{ ts: 1, type: "say", say: "task", text: "task" },
			{ ts: 2, type: "ask", ask: "api_req_failed", text: "server error" },
		]
		const setInputValue = vi.fn()
		const setActiveQuote = vi.fn()
		const setSelectedImages = vi.fn()
		const setSelectedFiles = vi.fn()
		const draft = {
			revision: 7,
			text: "First paragraph.\n\nSecond paragraph.",
			activeQuote: null,
			images: ["image.png"],
			files: ["notes.md"],
		}
		const { result } = renderHook(() =>
			useMessageHandlers(
				failedConversation,
				makeChatState(failedConversation, {
					inputValue: draft.text,
					selectedImages: draft.images,
					selectedFiles: draft.files,
					setInputValue,
					setActiveQuote,
					setSelectedImages,
					setSelectedFiles,
				}),
			),
		)

		await act(async () => {
			await result.current.executeButtonAction({ type: "retry" })
		})

		expect(askResponse).toHaveBeenCalledWith({ responseType: "yesButtonClicked" })
		expect(setInputValue).not.toHaveBeenCalled()
		expect(setActiveQuote).not.toHaveBeenCalled()
		expect(setSelectedImages).not.toHaveBeenCalled()
		expect(setSelectedFiles).not.toHaveBeenCalled()
	})

	it("clears only the draft snapshot submitted with an approval", async () => {
		mockTurnState = { phase: "awaiting_approval", anchorTs: 2, seq: 3 }
		const approvalConversation: ClineMessage[] = [
			{ ts: 1, type: "say", say: "task", text: "task" },
			{ ts: 2, type: "ask", ask: "tool", text: JSON.stringify({ tool: "newFileCreated", path: "notes.md" }) },
		]
		const consumeDraftSnapshot = vi.fn()
		const draft = {
			revision: 11,
			text: "submitted feedback",
			activeQuote: "selected context",
			images: ["old.png"],
			files: ["old.md"],
		}
		const { result } = renderHook(() =>
			useMessageHandlers(approvalConversation, makeChatState(approvalConversation, { consumeDraftSnapshot })),
		)

		await act(async () => {
			await result.current.executeButtonAction({ type: "approve", draft })
		})

		expect(askResponse).toHaveBeenCalledWith({
			responseType: "yesButtonClicked",
			text: `[context] \n>  ${draft.activeQuote} \n[/context] \n\n ${draft.text}`,
			images: draft.images,
			files: draft.files,
		})
		expect(consumeDraftSnapshot).toHaveBeenCalledWith(draft)
	})

	it("does not submit a quote without message content", async () => {
		mockTurnState = { phase: "awaiting_approval", anchorTs: 2, seq: 3 }
		const approvalConversation: ClineMessage[] = [
			{ ts: 1, type: "say", say: "task", text: "task" },
			{ ts: 2, type: "ask", ask: "tool", text: JSON.stringify({ tool: "newFileCreated", path: "notes.md" }) },
		]
		const consumeDraftSnapshot = vi.fn()
		const draft = {
			revision: 12,
			text: "  ",
			activeQuote: "selected context",
			images: [],
			files: [],
		}
		const { result } = renderHook(() =>
			useMessageHandlers(approvalConversation, makeChatState(approvalConversation, { consumeDraftSnapshot })),
		)

		await act(async () => {
			await result.current.executeButtonAction({ type: "approve", draft })
		})

		expect(askResponse).toHaveBeenCalledWith({ responseType: "yesButtonClicked" })
		expect(consumeDraftSnapshot).toHaveBeenCalledWith(draft)
	})

	// The webview does not gate sends on provider usability: submission always
	// reaches the extension, which surfaces auth/config problems as chat errors
	// (emitClineAuthError for the Cline provider, say:"error" otherwise).
	it("always forwards a new task to the extension (no webview-side provider gate)", async () => {
		mockTurnState = { phase: "idle", seq: 1 }
		const { result } = renderHook(() => useMessageHandlers([], makeChatState([])))

		await act(async () => {
			await result.current.handleSendMessage("should be sent", [], [])
		})

		expect(newTask).toHaveBeenCalledTimes(1)
		expect(newTask).toHaveBeenCalledWith(expect.objectContaining({ text: "should be sent", images: [], files: [] }))
		expect(askResponse).not.toHaveBeenCalled()
	})
})
