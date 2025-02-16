import { useContext } from "react"

import { chatMessageContext } from "./ChatMessageProvider"

export const useChatMessage = () => {
	const context = useContext(chatMessageContext)

	if (!context) {
		throw new Error("useChatMessage must be used within a ChatMessageProvider")
	}

	return context
}
