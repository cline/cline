import { useContext } from "react"

import { chatInputContext } from "./ChatInputProvider"

export const useChatInput = () => {
	const context = useContext(chatInputContext)

	if (!context) {
		throw new Error("useChatInput must be used within a ChatInputProvider")
	}

	return context
}
