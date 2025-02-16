import { createContext } from "react"

import { Message } from "./types"

export interface ChatMessageContext {
	message: Message
	isLast: boolean
}

export const chatMessageContext = createContext<ChatMessageContext | null>(null)

export const ChatMessageProvider = chatMessageContext.Provider
