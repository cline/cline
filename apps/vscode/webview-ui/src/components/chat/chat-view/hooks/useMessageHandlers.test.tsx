import type { ClineMessage, TurnState } from "@shared/ExtensionMessage"
import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks -------------------------------------------------------------------
// gRPC clients: record which RPC the send path chose.
const newTask = vi.fn().mockResolvedValue(undefined)
const askResponse = vi.fn().mockResolvedValue(undefined)
const condense = vi.fn().mockResolvedValue(undefined)
const trackIntent = vi.fn().mockResolvedValue(undefined)

vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: {
		newTask: (req: unknown) => newTask(req),
		askResponse: (req: unknown) => askResponse(req),
		clearTask: vi.fn().mockResolvedValue(undefined),
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

// useExtensionState supplies turnState (+ backgroundCommandRunning) to the hook.
let mockTurnState: TurnState | undefined
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		backgroundCommandRunning: false,
		turnState: mockTurnState,
	}),
}))

import type { ChatState } from "../types/chatTypes"
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
		condense.mockReset()
		condense.mockResolvedValue(undefined)
		trackIntent.mockReset()
		trackIntent.mockResolvedValue(undefined)
		mockTurnState = undefined
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
