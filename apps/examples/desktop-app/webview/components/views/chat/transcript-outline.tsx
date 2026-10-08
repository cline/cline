"use client";

import {
	useMessageScroller,
	useMessageScrollerVisibility,
} from "@cline/ui/components/message-scroller";
import { useMemo } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ChatMessage } from "@/lib/chat-schema";
import { formatChatMessageContent } from "./message-content";
import { isSystemSteeringMessage } from "./messages/group-messages";

export function TranscriptOutline({ messages }: { messages: ChatMessage[] }) {
	const { scrollToMessage } = useMessageScroller();
	const { currentAnchorId } = useMessageScrollerVisibility();
	const userMessages = useMemo(
		() =>
			messages.filter(
				(message) =>
					message.role === "user" && !isSystemSteeringMessage(message),
			),
		[messages],
	);
	if (userMessages.length === 0) return null;
	return (
		<nav
			aria-label="Transcript outline"
			className="absolute left-2 top-1/2 z-10 flex max-h-[calc(100%-3rem)] -translate-y-1/2 flex-col overflow-y-auto rounded-md bg-background/90 p-1"
		>
			{userMessages.map((message, index) => {
				const preview =
					formatChatMessageContent("user", message.content).replace(
						/\s+/g,
						" ",
					) || (message.images?.length ? "Image attachment" : "User message");
				return (
					<Tooltip key={message.id}>
						<TooltipTrigger asChild>
							<button
								type="button"
								aria-label={`Go to message ${index + 1}: ${preview.slice(0, 120)}`}
								aria-current={
									currentAnchorId === message.id ? "location" : undefined
								}
								className="group flex h-4 w-7 shrink-0 items-center justify-start rounded-sm px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
								onClick={() =>
									scrollToMessage(message.id, {
										align: "start",
										behavior: window.matchMedia(
											"(prefers-reduced-motion: reduce)",
										).matches
											? "instant"
											: "smooth",
									})
								}
							>
								<span className="h-0.5 w-4 rounded-full bg-muted-foreground/40 transition-[width,background-color] duration-150 ease-out group-hover:w-5 group-hover:bg-foreground group-focus-visible:w-5 group-focus-visible:bg-foreground group-aria-[current=location]:w-5 group-aria-[current=location]:bg-foreground motion-reduce:transition-none" />
							</button>
						</TooltipTrigger>
						<TooltipContent
							side="right"
							sideOffset={8}
							variant="surface"
							className="max-w-64"
						>
							<span className="line-clamp-3">{preview}</span>
						</TooltipContent>
					</Tooltip>
				);
			})}
		</nav>
	);
}
