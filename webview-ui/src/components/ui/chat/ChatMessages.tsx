import { useEffect, useRef } from "react"
import { Virtuoso, VirtuosoHandle } from "react-virtuoso"

import { useChatUI } from "./useChatUI"
import { ChatMessage } from "./ChatMessage"

export function ChatMessages() {
	const { messages, isLoading, append } = useChatUI()
	const messageCount = messages.length
	const virtuoso = useRef<VirtuosoHandle>(null)

	useEffect(() => {
		if (!virtuoso.current) {
			return
		}

		requestAnimationFrame(() =>
			virtuoso.current?.scrollToIndex({ index: messageCount - 1, align: "end", behavior: "smooth" }),
		)
	}, [messageCount])

	return (
		<Virtuoso
			ref={virtuoso}
			data={messages}
			totalCount={messageCount}
			itemContent={(index, message) => (
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
			)}
		/>
	)
}
