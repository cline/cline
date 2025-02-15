import { createContext } from "react"

import { ChatHandler } from "./types"

type ChatContext = ChatHandler & {
	assistantName: string
}

export const chatContext = createContext<ChatContext | null>(null)

export const ChatProvider = chatContext.Provider
