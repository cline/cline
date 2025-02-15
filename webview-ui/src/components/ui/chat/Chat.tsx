import { HTMLAttributes } from "react"

import { cn } from "@/lib/utils"

import { ChatHandler } from "./types"
import { ChatProvider } from "./ChatProvider"
import { ChatMessages } from "./ChatMessages"
import { ChatInput } from "./ChatInput"

type ChatProps = HTMLAttributes<HTMLDivElement> & {
	assistantName: string
	handler: ChatHandler
}

export const Chat = ({ assistantName, handler, ...props }: ChatProps) => (
	<ChatProvider value={{ assistantName, ...handler }}>
		<InnerChat {...props} />
	</ChatProvider>
)

type InnerChatProps = HTMLAttributes<HTMLDivElement>

const InnerChat = ({ className, children, ...props }: InnerChatProps) => (
	<div className={cn("relative flex flex-col flex-1 min-h-0", className)} {...props}>
		<ChatMessages />
		{children}
		<ChatInput />
	</div>
)
