import type { ClineMessage, TurnState } from "@shared/ExtensionMessage"
import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks -------------------------------------------------------------------
// gRPC clients: record which RPC the send path chose.
const newTask = vi.fn().mockResolvedValue(undefined)
const askResponse = vi.fn().mockResolvedValue(undefined)
const condense = vi.fn().mockResolvedValue(undefined)

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
}))

// Proto request factories just echo their input so we can assert on it.
vi.mock("@shared/proto/cline/task", () => ({
	AskResponseRequest: { create: (x: unknown) => x },
	NewTaskRequest: { create: (x: unknown) => x },
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
	})

	it("does not intercept /compact when there is no active task (starts a new task instead)", async () => {
		mockTurnState = { phase: "idle", seq: 1 }
		const { result } = renderHook(() => useMessageHandlers([], makeChatState([])))

		await act(async () => {
			await result.current.handleSendMessage("/compact", [], [])
		})

		expect(condense).not.toHaveBeenCalled()
		expect(newTask).toHaveBeenCalledTimes(1)
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
	})

	it("clears and renders a follow-up optimistically before askResponse resolves", async () => {
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
		const removeOptimisticUserMessage = vi.fn()
		const addOptimisticUserMessage = vi.fn(() => removeOptimisticUserMessage)
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
		})
		const { result } = renderHook(() => useMessageHandlers(completedConversation, chatState, { addOptimisticUserMessage }))

		let sendPromise: Promise<void> = Promise.resolve()
		await act(async () => {
			sendPromise = result.current.handleSendMessage("another question", ["image.png"], ["a.ts"])
			await Promise.resolve()
		})

		expect(setInputValue).toHaveBeenCalledWith("")
		expect(setActiveQuote).toHaveBeenCalledWith(null)
		expect(setSendingDisabled).toHaveBeenCalledWith(true)
		expect(setSelectedImages).toHaveBeenCalledWith([])
		expect(setSelectedFiles).toHaveBeenCalledWith([])
		expect(setEnableButtons).toHaveBeenCalledWith(false)
		expect(addOptimisticUserMessage).toHaveBeenCalledWith(
			expect.stringContaining("another question"),
			["image.png"],
			["a.ts"],
		)
		expect(removeOptimisticUserMessage).not.toHaveBeenCalled()

		await act(async () => {
			resolveAskResponse()
			await sendPromise
		})
	})

	it("removes the optimistic follow-up and restores input when askResponse fails", async () => {
		mockTurnState = { phase: "completed", seq: 7 }
		const error = new Error("transport down")
		const setInputValue = vi.fn()
		const setActiveQuote = vi.fn()
		const setSendingDisabled = vi.fn()
		const setSelectedImages = vi.fn()
		const setSelectedFiles = vi.fn()
		const setEnableButtons = vi.fn()
		const removeOptimisticUserMessage = vi.fn()
		const addOptimisticUserMessage = vi.fn(() => removeOptimisticUserMessage)
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
		})
		const { result } = renderHook(() => useMessageHandlers(completedConversation, chatState, { addOptimisticUserMessage }))
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
		expect(removeOptimisticUserMessage).toHaveBeenCalledTimes(1)
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
	})

	it("clears action response UI state before askResponse resolves", async () => {
		mockTurnState = { phase: "awaiting_approval", seq: 8 }
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
		const addOptimisticUserMessage = vi.fn(() => vi.fn())
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
		})
		const { result } = renderHook(() => useMessageHandlers(completedConversation, chatState, { addOptimisticUserMessage }))

		let actionPromise: Promise<void> = Promise.resolve()
		await act(async () => {
			actionPromise = result.current.executeButtonAction("reject", "not yet", ["image.png"], ["a.ts"])
			await Promise.resolve()
		})

		expect(askResponse).toHaveBeenCalledWith(
			expect.objectContaining({
				responseType: "noButtonClicked",
				text: "not yet",
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
		expect(addOptimisticUserMessage).toHaveBeenCalledWith("not yet", ["image.png"], ["a.ts"])

		await act(async () => {
			resolveAskResponse()
			await actionPromise
		})
	})

	it("phase awaiting_followup also routes a follow-up to askResponse", async () => {
		mockTurnState = { phase: "awaiting_followup", seq: 3 }
		const { result } = renderHook(() => useMessageHandlers(completedConversation, makeChatState(completedConversation)))

		await act(async () => {
			await result.current.handleSendMessage("more info", [], [])
		})

		expect(newTask).not.toHaveBeenCalled()
		expect(askResponse).toHaveBeenCalledTimes(1)
	})

	it("an empty transcript still starts a NEW task (unchanged behavior)", async () => {
		mockTurnState = { phase: "idle", seq: 1 }
		const { result } = renderHook(() => useMessageHandlers([], makeChatState([])))

		await act(async () => {
			await result.current.handleSendMessage("brand new task", [], [])
		})

		expect(newTask).toHaveBeenCalledTimes(1)
		expect(askResponse).not.toHaveBeenCalled()
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
