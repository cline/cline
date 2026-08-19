"use client";

import {
	Conversation as AgentConversation,
	ConversationContent,
	ConversationScrollButton,
	ConversationViewport,
	Message,
	MessageAction,
	MessageActions,
	MessageContent,
} from "@cline/ui/components/agent-chat";
import type { DesktopProjection, MessageProjection } from "@shared/projection";
import {
	Check,
	CircleAlert,
	Copy,
	Loader2,
	Wrench,
} from "lucide-react";
import { useCallback, useState } from "react";
import { Markdown } from "@/components/ui/markdown";
import type { BridgeClient } from "@/lib/bridge-client";
import { cn } from "@/lib/utils";

function MessageBubble({
	message,
	streaming = false,
}: {
	message: MessageProjection;
	streaming?: boolean;
}) {
	const [copied, setCopied] = useState(false);
	const isUser = message.role === "user";
	const copy = useCallback(async () => {
		await navigator.clipboard.writeText(message.text);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1600);
	}, [message.text]);

	return (
		<Message
			className={cn(
				"relative flex flex-col gap-2",
				isUser && "mt-4 first:mt-0",
			)}
			from={isUser ? "user" : "assistant"}
		>
			<MessageContent className="flex min-w-0 flex-col gap-2 wrap-break-word">
				<div className="cline-chat-message-content min-w-0 max-w-full wrap-break-word">
					<Markdown
						content={message.text || "(no text content)"}
						streaming={streaming}
					/>
				</div>
				{message.truncated ? (
					<span className="text-xs italic text-muted-foreground">
						Content truncated for display
					</span>
				) : null}
			</MessageContent>
			{!streaming ? (
				<MessageActions side={isUser ? "end" : "start"} visible={!isUser}>
					<MessageAction
						label="Copy message"
						onClick={() => void copy()}
						title={copied ? "Copied" : "Copy message"}
					>
						{copied ? (
							<Check className="size-3" />
						) : (
							<Copy className="size-3" />
						)}
					</MessageAction>
					<time className="text-xs text-muted-foreground/70">
						{new Date(message.createdAt).toLocaleTimeString(undefined, {
							hour: "numeric",
							minute: "2-digit",
						})}
					</time>
				</MessageActions>
			) : null}
		</Message>
	);
}

export function Conversation({
	client,
	projection,
}: {
	client: BridgeClient;
	projection: DesktopProjection;
}) {
	const active = projection.activeSession;
	const currentRun = active?.currentRun;
	const messages = active?.messages ?? [];

	return (
		<div className="flex min-h-0 flex-1 flex-col" data-testid="conversation">
			<AgentConversation
				className="relative isolate min-h-0 flex-1 overflow-hidden"
				key={active?.sessionId ?? "new-chat"}
			>
				<ConversationViewport
					aria-label="Agent conversation"
					className="h-full min-h-0 min-w-0"
				>
					<ConversationContent className="mx-auto min-h-full w-full max-w-(--breakpoint-lg) px-6 pt-6 pb-16">
						{!active || (messages.length === 0 && !active.streaming) ? (
							<div className="flex min-h-[50vh] items-center justify-center text-center">
								<div>
									<div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
										<span className="text-xl">✦</span>
									</div>
									<h2 className="text-lg font-semibold">
										What can I help you build?
									</h2>
									<p className="mt-1 text-sm text-muted-foreground">
										Gateway runs continue if this window closes.
									</p>
								</div>
							</div>
						) : (
							<div className="flex min-w-0 flex-col gap-4">
								{messages.map((message) => (
									<MessageBubble key={message.id} message={message} />
								))}
								{active.streaming ? (
									<MessageBubble
										message={{
											id: `stream-${active.streaming.runId}`,
											role: "assistant",
											text: active.streaming.text,
											createdAt: Date.now(),
										}}
										streaming
									/>
								) : null}
								{active.tools.map((tool) => (
									<div
										className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs"
										key={tool.toolCallId}
									>
										<Wrench className="size-3.5 text-muted-foreground" />
										<span className="font-medium">{tool.toolName}</span>
										<span className="text-muted-foreground">{tool.state}</span>
										{tool.state === "running" ? (
											<Loader2 className="ml-auto size-3 animate-spin" />
										) : null}
									</div>
								))}
								{currentRun?.error ? (
									<div className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
										<CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
										<div>
											<p className="font-medium text-destructive">
												{currentRun.error.name}
											</p>
											<p className="cline-chat-selectable text-muted-foreground">
												{currentRun.error.message}
											</p>
										</div>
									</div>
								) : null}
							</div>
						)}
					</ConversationContent>
				</ConversationViewport>
				<ConversationScrollButton />
			</AgentConversation>
		</div>
	);
}
