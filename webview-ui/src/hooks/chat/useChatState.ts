import { useReducer, useEffect, useMemo, useRef } from "react"
import { chatStateReducer } from "./chatStateMachine"
import { deriveContextFromState, deriveInitialState } from "./chatStateUtils"
import { ChatStateContext } from "./chatStateTypes"
import { ClineMessage } from "@shared/ExtensionMessage"
import { TaskServiceClient } from "@/services/grpc-client"
import { AskResponseRequest, NewTaskRequest } from "@shared/proto/task"

import { ChatState, ChatEvent } from "./chatStateTypes"

export function useChatState(messages: ClineMessage[], task?: ClineMessage) {
	const [internalState, dispatch] = useReducer(chatStateReducer, { state: { type: "NO_TASK" }, effects: [] })

	console.log("[useChatState] Current internal state:", internalState)

	useEffect(() => {
		const hasTask = !!task
		const initialState = deriveInitialState(messages[messages.length - 1], hasTask)
		console.log("[useChatState] Initializing with state:", initialState, "hasTask:", hasTask)
		dispatch({ type: "INITIALIZE", state: initialState })
	}, [task?.ts, task])

	const lastMessageRef = useRef<ClineMessage>()
	useEffect(() => {
		const lastMessage = messages[messages.length - 1]
		if (lastMessage && lastMessage !== lastMessageRef.current) {
			lastMessageRef.current = lastMessage
			dispatch({ type: "MESSAGE_RECEIVED", message: lastMessage })
		}
	}, [messages])

	useEffect(() => {
		const { effects } = internalState
		console.log("[useChatState] Effects to execute:", effects)
		if (effects && effects.length > 0) {
			effects.forEach((effect: any) => {
				console.log("[useChatState] Executing effect:", effect.type, effect)
				switch (effect.type) {
					case "CREATE_TASK":
						console.log("[useChatState] Creating new task with:", effect.content)
						TaskServiceClient.newTask(
							NewTaskRequest.create({ text: effect.content, images: effect.images, files: effect.files }),
						)
						break
					case "SEND_MESSAGE":
						console.log("[useChatState] Sending message:", effect.content)
						TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "messageResponse",
								text: effect.content,
								images: effect.images,
								files: effect.files,
							}),
						)
						break
					default:
						console.log("[useChatState] Unknown effect type:", effect.type)
				}
			})
		}
	}, [internalState.effects])

	const context: Omit<ChatStateContext, "inputValue" | "selectedImages" | "selectedFiles" | "activeQuote"> = useMemo(() => {
		return deriveContextFromState(internalState.state)
	}, [internalState.state])

	return {
		state: internalState.state,
		context,
		dispatch: dispatch as React.Dispatch<ChatEvent>,
		actions: {
			handleInputChange: (content: string, images?: string[], files?: string[]) => {
				console.log("[useChatState] handleInputChange called with:", { content, images, files })
				dispatch({ type: "INPUT_CHANGED", content, images, files })
			},
			handleSend: () => {
				console.log("[useChatState] handleSend called")
				dispatch({ type: "SEND_CLICKED" })
			},
			handleModeToggle: () => {
				console.log("[useChatState] handleModeToggle called")
				dispatch({ type: "MODE_TOGGLE_CLICKED" })
			},
			handlePrimaryButton: (input?: string) => {
				console.log("[useChatState] handlePrimaryButton called with:", input)
				dispatch({ type: "PRIMARY_BUTTON_CLICKED", input })
			},
			handleSecondaryButton: (input?: string) => {
				console.log("[useChatState] handleSecondaryButton called with:", input)
				dispatch({ type: "SECONDARY_BUTTON_CLICKED", input })
			},
		},
	}
}
