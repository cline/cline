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
import { Check, CircleAlert, Copy, Loader2, Wrench } from "lucide-react";
import { Fragment, useCallback, useState } from "react";
import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/lib/utils";

function WaitingDots() {
	return (
		<span aria-hidden className="flex items-center gap-0.5">
			<span className="size-1 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
			<span className="size-1 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
			<span className="size-1 animate-bounce rounded-full bg-current" />
		</span>
	);
}

function ToolStatus({
	tool,
}: {
	tool: DesktopProjection["activeSession"]["tools"][number];
}) {
	return (
		<div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
			<Wrench className="size-3.5 text-muted-foreground" />
			<span className="font-medium">{tool.toolName}</span>
			<span className="text-muted-foreground">{tool.state}</span>
			{tool.state === "running" ? (
				<Loader2 className="ml-auto size-3 animate-spin" />
			) : null}
		</div>
	);
}

function MessageBubble({
	message,
	streaming = false,
	completed = false,
}: {
	message: MessageProjection;
	streaming?: boolean;
	completed?: boolean;
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
				"relative mb-7 flex flex-col gap-2 last:mb-0",
				isUser && "mt-4 first:mt-0",
				completed &&
					"gwd-task-complete rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3",
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
	projection,
}: {
	projection: DesktopProjection;
}) {
	const active = projection.activeSession;
	const currentRun = active?.currentRun;
	const messages = (active?.messages ?? []).filter(
		(message) => message.text.trim().length > 0,
	);
	const modelWorking = currentRun?.state === "running";
	const botName =
		projection.bots.find((bot) => bot.botId === projection.selectedBotId)
			?.name ?? "Cline";
	const pendingApprovalToolIds = new Set(
		projection.approvals.flatMap((approval) =>
			approval.toolCallId ? [approval.toolCallId] : [],
		),
	);
	const visibleTools = (active?.tools ?? []).filter(
		(tool) => !pendingApprovalToolIds.has(tool.toolCallId),
	);
	const completedMessageId =
		currentRun?.state === "completed"
			? [...messages].reverse().find((message) => message.role === "assistant")
					?.id
			: undefined;

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
										Hi! I&apos;m {botName}! What can I help you with today?
									</h2>
									<p className="mt-1 text-sm text-muted-foreground">
										Gateway runs continue if this window closes.
									</p>
								</div>
							</div>
						) : (
							<div className="flex min-w-0 flex-col gap-4">
								{messages.map((message) => {
									const firstMessageForRun = message.runId
										? messages.find((entry) => entry.runId === message.runId)
										: undefined;
									const toolsForMessage = visibleTools.filter(
										(tool) =>
											message.toolCallIds?.includes(tool.toolCallId) ||
											(firstMessageForRun?.id === message.id &&
												tool.runId !== undefined &&
												tool.runId === message.runId),
									);
									return (
										<Fragment key={message.id}>
											<MessageBubble
												completed={message.id === completedMessageId}
												message={message}
											/>
											{toolsForMessage.map((tool) => (
												<ToolStatus key={tool.toolCallId} tool={tool} />
											))}
										</Fragment>
									);
								})}
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
								{visibleTools
									.filter(
										(tool) =>
											!tool.runId ||
											!messages.some((message) => message.runId === tool.runId),
									)
									.map((tool) => (
										<ToolStatus key={tool.toolCallId} tool={tool} />
									))}
								{currentRun?.state === "completed" &&
								currentRun.outputPreview &&
								!completedMessageId ? (
									<div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
										<p className="cline-chat-selectable whitespace-pre-wrap text-muted-foreground">
											{currentRun.outputPreview}
										</p>
									</div>
								) : null}
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
				{modelWorking ? (
					<output
						aria-label="Waiting for model response"
						className="cline-chat-scroll-button pointer-events-none !right-auto !left-1/2 -translate-x-1/2"
					>
						<WaitingDots />
					</output>
				) : (
					<ConversationScrollButton className="!right-auto !left-1/2 -translate-x-1/2" />
				)}
			</AgentConversation>
		</div>
	);
}
