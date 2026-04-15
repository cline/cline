"use client";

import { formatDisplayUserInput } from "@clinebot/shared";
import {
	Check,
	Copy,
	Info,
	Loader2,
	MessageSquare,
	Send,
	Wrench,
	XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	type ChatMessage,
	ChatMessageSchema,
	type ChatSessionStatus,
	ChatSessionStatusSchema,
} from "@/lib/chat-schema";
import { cn } from "@/lib/utils";

type ChatMessagesProps = {
	sessionId: string | null;
	status: ChatSessionStatus;
	provider: string;
	model: string;
	messages: ChatMessage[];
	error: string | null;
	promptInput: string;
	onPromptInputChange: (value: string) => void;
	onSend: () => void;
};

function roleLabel(role: ChatMessage["role"]): string {
	switch (role) {
		case "assistant":
			return "Assistant";
		case "user":
			return "You";
		case "tool":
			return "Tool";
		case "status":
			return "Status";
		case "error":
			return "Error";
		default:
			return "System";
	}
}

function MessageBubble({
	message,
	provider,
	model,
}: {
	message: ChatMessage;
	provider: string;
	model: string;
}) {
	const [copied, setCopied] = useState(false);
	const isUser = message.role === "user";

	function handleCopy() {
		void navigator.clipboard.writeText(message.content);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}

	return (
		<div
			className={cn(
				"group flex flex-col gap-2",
				isUser ? "items-end" : "items-start",
			)}
		>
			<div className="flex items-center gap-2">
				<span
					className={cn(
						"text-[10px] font-semibold uppercase tracking-wider",
						isUser ? "text-warning" : "text-primary",
					)}
				>
					{roleLabel(message.role)}
				</span>
				{!isUser && message.role === "assistant" && (
					<span className="text-[10px] text-muted-foreground">
						{provider}/{model}
					</span>
				)}
				<span className="text-[10px] text-muted-foreground">
					{new Date(message.createdAt).toLocaleTimeString([], {
						hour: "2-digit",
						minute: "2-digit",
					})}
				</span>
			</div>

			<div
				className={cn(
					"max-w-full rounded-xl px-4 py-3",
					isUser && "ml-12 border border-warning/20 bg-warning/5",
					message.role === "assistant" && "mr-6 border border-border bg-card",
					message.role === "tool" &&
						"mr-6 border border-chart-5/25 bg-chart-5/10",
					message.role === "status" &&
						"mr-6 border border-success/25 bg-success/10",
					message.role === "system" && "mr-6 border border-border bg-muted/25",
					message.role === "error" &&
						"mr-6 border border-destructive/30 bg-destructive/10",
				)}
			>
				{message.role === "tool" && (
					<div className="mb-2 flex items-center gap-1.5 text-[11px] text-chart-5">
						<Wrench className="h-3 w-3" />
						<span>{message.meta?.toolName ?? "tool_call"}</span>
					</div>
				)}
				{message.role === "error" && (
					<div className="mb-2 flex items-center gap-1.5 text-[11px] text-destructive">
						<XCircle className="h-3 w-3" />
						<span>Runtime Error</span>
					</div>
				)}
				<p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
					{isUser ? formatDisplayUserInput(message.content) : message.content}
				</p>
			</div>

			<div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
				<button
					aria-label="Copy message text"
					className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
					onClick={handleCopy}
					type="button"
				>
					{copied ? (
						<Check className="h-3 w-3" />
					) : (
						<Copy className="h-3 w-3" />
					)}
					<span>{copied ? "Copied" : "Copy"}</span>
				</button>
				{message.meta && (
					<div className="flex items-center gap-2 text-[10px] text-muted-foreground">
						{typeof message.meta.inputTokens === "number" && (
							<span>{message.meta.inputTokens.toLocaleString()} in</span>
						)}
						{typeof message.meta.outputTokens === "number" && (
							<span>{message.meta.outputTokens.toLocaleString()} out</span>
						)}
						{typeof message.meta.iteration === "number" && (
							<span>iter {message.meta.iteration}</span>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

export function ChatMessages(props: ChatMessagesProps) {
	const {
		sessionId,
		status,
		provider,
		model,
		messages,
		error,
		promptInput,
		onPromptInputChange,
		onSend,
	} = props;
	const [isComposing, setIsComposing] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	const safeStatus = useMemo(
		() => ChatSessionStatusSchema.parse(status),
		[status],
	);
	const safeMessages = useMemo(() => {
		const parsed = ChatMessageSchema.array().safeParse(messages);
		if (!parsed.success) {
			return [];
		}
		return [...parsed.data].sort((a, b) => a.createdAt - b.createdAt);
	}, [messages]);

	const isBusy = safeStatus === "starting" || safeStatus === "stopping";
	const canCompose = !isBusy;

	const totalTokens = useMemo(
		() =>
			safeMessages.reduce(
				(sum, msg) =>
					sum + (msg.meta?.inputTokens ?? 0) + (msg.meta?.outputTokens ?? 0),
				0,
			),
		[safeMessages],
	);

	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, []);

	useEffect(() => {
		const el = inputRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
	}, []);

	return (
		<section className="flex min-h-[60vh] flex-col rounded-xl border border-border bg-card">
			<div className="flex items-center justify-between border-b border-border px-4 py-3">
				<div>
					<h2 className="text-sm font-semibold text-foreground">
						Conversation
					</h2>
					<p className="text-[10px] text-muted-foreground sm:text-xs">
						{safeMessages.length} messages
						{totalTokens > 0 && ` / ${totalTokens.toLocaleString()} tokens`}
						{sessionId ? ` / ${sessionId}` : ""}
					</p>
					<p className="text-[10px] text-muted-foreground sm:text-xs">
						{provider}/{model}
					</p>
					{error && <p className="text-[11px] text-destructive">{error}</p>}
				</div>
			</div>

			<div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6" ref={scrollRef}>
				{safeMessages.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center gap-3 text-center">
						<div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-card">
							<MessageSquare className="h-6 w-6 text-warning" />
						</div>
						<h3 className="text-sm font-semibold text-foreground">
							Start a conversation
						</h3>
						<p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
							Send your first message and a session will start automatically.
						</p>
					</div>
				) : (
					<div className="mx-auto flex max-w-3xl flex-col gap-6">
						{safeMessages.map((msg) => (
							<MessageBubble
								key={msg.id}
								message={msg}
								model={model}
								provider={provider}
							/>
						))}

						{isBusy && (
							<div className="flex items-start gap-2">
								<span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
									Assistant
								</span>
								<div className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-3">
									<Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
									<span className="text-xs text-muted-foreground">
										{safeStatus === "starting" ? "Starting..." : "Stopping..."}
									</span>
								</div>
							</div>
						)}
					</div>
				)}
			</div>

			<div className="border-t border-border bg-card/50 px-4 py-2 sm:px-6">
				<div className="mx-auto flex max-w-3xl items-center gap-2">
					<Info className="h-3 w-3 shrink-0 text-muted-foreground" />
					<p className="text-[10px] leading-relaxed text-muted-foreground">
						Interactive agent output from the desktop chat API using the shared
						agents and llms packages.
					</p>
				</div>
			</div>

			<div className="border-t border-border px-4 py-3 sm:px-6">
				<div className="mx-auto flex max-w-3xl items-end gap-2">
					<div className="relative flex-1">
						<textarea
							className="max-h-40 min-h-[40px] w-full resize-none rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-warning disabled:opacity-50"
							disabled={!canCompose}
							onChange={(e) => onPromptInputChange(e.target.value)}
							onCompositionEnd={() => setIsComposing(false)}
							onCompositionStart={() => setIsComposing(true)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.shiftKey && !isComposing) {
									e.preventDefault();
									onSend();
								}
							}}
							placeholder={
								canCompose
									? "Type your message... (Shift+Enter for newline)"
									: "Please wait..."
							}
							ref={inputRef}
							rows={1}
							value={promptInput}
						/>
					</div>
					<Button
						aria-label="Send message"
						className="h-10 w-10 shrink-0 rounded-xl bg-primary p-0 text-warning-foreground hover:bg-warning/90"
						disabled={!promptInput.trim() || !canCompose}
						onClick={onSend}
						size="sm"
					>
						{isBusy ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Send className="h-4 w-4" />
						)}
					</Button>
				</div>
			</div>
		</section>
	);
}
