import { createContext } from "react"

interface ChatInputContext {
	isDisabled: boolean
	handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
	handleSubmit: (e: React.FormEvent<HTMLFormElement>) => void
}

export const chatInputContext = createContext<ChatInputContext | null>(null)

export const ChatInputProvider = chatInputContext.Provider
