import { useContext } from "react"

import { chatContext } from "./ChatProvider"

export const useChatUI = () => {
	const context = useContext(chatContext)

	if (!context) {
		throw new Error("useChatUI must be used within a ChatProvider")
	}

	return context
}
