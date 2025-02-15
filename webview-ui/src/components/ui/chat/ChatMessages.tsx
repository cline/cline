import { useCallback, useEffect, useRef } from "react"

import { useChatUI } from "./useChatUI"
import { ChatMessage } from "./ChatMessage"

export function ChatMessages() {
	const { messages, isLoading, append } = useChatUI()
	const containerRef = useRef<HTMLDivElement>(null)
	const messageCount = messages.length

	const scrollToBottom = useCallback(() => {
		if (!containerRef.current) {
			return
		}

		requestAnimationFrame(() => {
			containerRef.current?.scrollTo({
				top: containerRef.current.scrollHeight,
				behavior: "smooth",
			})
		})
	}, [])

	useEffect(() => scrollToBottom(), [messageCount, scrollToBottom])

	return (
		<div ref={containerRef} className="flex flex-col flex-1 min-h-0 overflow-auto relative">
			{messages.map((message, index) => (
				<ChatMessage
					key={index}
					message={message}
					isHeaderVisible={
						!!message.annotations?.length || index === 0 || messages[index - 1].role !== message.role
					}
					isLast={index === messageCount - 1}
					isLoading={isLoading}
					append={append}
				/>
			))}
		</div>
	)
}
