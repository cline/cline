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

	useEffect(() => {
		const initialState = deriveInitialState(messages[messages.length - 1])
		dispatch({ type: "INITIALIZE", state: initialState })
	}, [task?.ts])

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
		if (effects) {
			effects.forEach((effect: any) => {
				switch (effect.type) {
					case "CREATE_TASK":
						TaskServiceClient.newTask(
							NewTaskRequest.create({ text: effect.content, images: effect.images, files: effect.files }),
						)
						break
					case "SEND_MESSAGE":
						TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "messageResponse",
								text: effect.content,
								images: effect.images,
								files: effect.files,
							}),
						)
						break
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
				dispatch({ type: "INPUT_CHANGED", content, images, files })
			},
			handleSend: () => {
				dispatch({ type: "SEND_CLICKED" })
			},
			handleModeToggle: () => {
				dispatch({ type: "MODE_TOGGLE_CLICKED" })
			},
			handlePrimaryButton: (input?: string) => {
				dispatch({ type: "PRIMARY_BUTTON_CLICKED", input })
			},
			handleSecondaryButton: (input?: string) => {
				dispatch({ type: "SECONDARY_BUTTON_CLICKED", input })
			},
		},
	}
}
