"use client";

import {
	ArrowLeft,
	ArrowUp,
	Cloud,
	CloudOff,
	GitBranch,
	Loader2,
	RefreshCw,
	Square,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { normalizeTitle } from "@/components/utils";
import { ChatMessages } from "@/components/views/chat/chat-messages";
import { useCloudChat } from "@/hooks/use-cloud-chat";
import type { ChatSessionStatus } from "@/lib/chat-schema";
import type { CloudRunStatus } from "@/lib/cloud-live-events";
import {
	type CloudConnectionState,
	type CloudRemoteSession,
	cloudSessionRepoName,
	isCloudSessionExpired,
} from "@/lib/cloud-sessions";
import { cn } from "@/lib/utils";

function toChatStatus(runStatus: CloudRunStatus): ChatSessionStatus {
	switch (runStatus) {
		case "running":
			return "running";
		case "completed":
			return "completed";
		case "aborted":
			return "cancelled";
		case "failed":
			return "failed";
		default:
			return "idle";
	}
}

function toChatTransportState(
	state: CloudConnectionState,
	expired: boolean,
): "connecting" | "reconnecting" | "connected" | "unavailable" {
	// An expired session renders a read-only archive; no transport indicator.
	if (expired) {
		return "connected";
	}
	switch (state) {
		case "connected":
			return "connected";
		case "reconnecting":
			return "reconnecting";
		case "connecting":
			return "connecting";
		default:
			return "unavailable";
	}
}

function connectionLabel(state: CloudConnectionState): string {
	switch (state) {
		case "connected":
			return "Connected";
		case "connecting":
			return "Connecting";
		case "reconnecting":
			return "Reconnecting";
		case "error":
			return "Connection failed";
		default:
			return "Disconnected";
	}
}

export function CloudSessionChat({
	session,
	onBack,
	initialPrompt,
	onInitialPromptConsumed,
}: {
	session: CloudRemoteSession;
	onBack: () => void;
	/** First task for a just-created session, sent once connected. */
	initialPrompt?: string;
	onInitialPromptConsumed?: () => void;
}) {
	const expired = isCloudSessionExpired(session);
	const {
		connectionState,
		connectionError,
		chat,
		isHydrating,
		sendPrompt,
		abortRun,
		respondApproval,
		reconnect,
	} = useCloudChat({ remoteSessionId: session.id, expired });
	const [promptInput, setPromptInput] = useState("");
	const [sending, setSending] = useState(false);
	const [aborting, setAborting] = useState(false);

	const initialPromptSentRef = useRef(false);
	useEffect(() => {
		if (
			!initialPrompt?.trim() ||
			initialPromptSentRef.current ||
			expired ||
			connectionState !== "connected"
		) {
			return;
		}
		initialPromptSentRef.current = true;
		onInitialPromptConsumed?.();
		void sendPrompt(initialPrompt.trim(), session.modelId).catch(() => {
			// Failure is surfaced through chat.lastError.
		});
	}, [
		connectionState,
		expired,
		initialPrompt,
		onInitialPromptConsumed,
		sendPrompt,
		session.modelId,
	]);

	const repoName = cloudSessionRepoName(session);
	const isRunning = chat.runStatus === "running";
	const canSend =
		!expired &&
		connectionState === "connected" &&
		promptInput.trim().length > 0 &&
		!sending;

	const handleSend = useCallback(async () => {
		const prompt = promptInput.trim();
		if (!prompt || sending) {
			return;
		}
		setSending(true);
		setPromptInput("");
		try {
			await sendPrompt(prompt, session.modelId);
		} catch {
			// The hook surfaces the failure in chat state; restore the draft so
			// nothing typed is lost.
			setPromptInput(prompt);
		} finally {
			setSending(false);
		}
	}, [promptInput, sending, sendPrompt, session.modelId]);

	const handleAbort = useCallback(async () => {
		setAborting(true);
		try {
			await abortRun();
		} finally {
			setAborting(false);
		}
	}, [abortRun]);

	const approve = useCallback(
		(requestId: string) => void respondApproval(requestId, true),
		[respondApproval],
	);
	const reject = useCallback(
		(requestId: string) => void respondApproval(requestId, false),
		[respondApproval],
	);

	return (
		<div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
			{/* Header */}
			<div className="z-20 border-b border-border/70 bg-background/85 backdrop-blur-sm">
				<div className="flex h-12 items-center gap-2 px-3">
					<Button
						aria-label="Back to cloud sessions"
						className="size-8 shrink-0"
						onClick={onBack}
						size="icon"
						title="Back"
						type="button"
						variant="ghost"
					>
						<ArrowLeft className="size-4" />
					</Button>
					<div className="min-w-0 flex-1">
						<p className="truncate text-sm font-medium text-foreground">
							{normalizeTitle(session.title || "Cloud session")}
						</p>
						<p className="flex items-center gap-2 text-[11px] text-muted-foreground">
							{repoName ? (
								<span className="inline-flex min-w-0 items-center gap-1">
									<GitBranch className="size-3 shrink-0" />
									<span className="truncate">{repoName}</span>
								</span>
							) : null}
							{session.modelId ? (
								<span className="truncate max-[560px]:hidden">
									{session.modelId}
								</span>
							) : null}
						</p>
					</div>
					{expired ? (
						<Badge variant="secondary">Expired</Badge>
					) : (
						<span
							className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
							title={connectionError ?? undefined}
						>
							{connectionState === "connected" ? (
								<Cloud className="size-3.5 text-emerald-500" />
							) : connectionState === "error" ? (
								<CloudOff className="size-3.5 text-destructive" />
							) : (
								<Loader2 className="size-3.5 animate-spin" />
							)}
							{connectionLabel(connectionState)}
						</span>
					)}
					{!expired &&
					(connectionState === "error" ||
						connectionState === "disconnected") ? (
						<Button
							className="h-7 gap-1.5 px-2 text-xs"
							onClick={reconnect}
							type="button"
							variant="outline"
						>
							<RefreshCw className="size-3" />
							Reconnect
						</Button>
					) : null}
					{isRunning && !expired ? (
						<Button
							className="h-7 gap-1.5 px-2 text-xs"
							disabled={aborting || connectionState !== "connected"}
							onClick={() => void handleAbort()}
							type="button"
							variant="outline"
						>
							{aborting ? (
								<Loader2 className="size-3 animate-spin" />
							) : (
								<Square className="size-3" />
							)}
							Stop
						</Button>
					) : null}
				</div>
			</div>

			{/* Messages */}
			<div className="min-h-0">
				{isHydrating && chat.messages.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
						<Loader2 className="size-5 animate-spin" />
						<p className="text-sm">
							{expired
								? "Loading archived transcript..."
								: "Connecting to the cloud session..."}
						</p>
					</div>
				) : connectionState === "error" && chat.messages.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
						<CloudOff className="size-6 text-muted-foreground" />
						<p className="text-sm font-medium text-foreground">
							Could not connect to this cloud session
						</p>
						{connectionError ? (
							<p className="max-w-md text-xs text-muted-foreground">
								{connectionError}
							</p>
						) : null}
						<Button onClick={reconnect} type="button" variant="outline">
							<RefreshCw className="size-4" />
							Try again
						</Button>
					</div>
				) : (
					<ChatMessages
						chatTransportState={toChatTransportState(connectionState, expired)}
						error={chat.lastError}
						messages={chat.messages}
						onAnswerAskQuestion={() => {}}
						onApproveToolApproval={approve}
						onRejectToolApproval={reject}
						pendingAskQuestions={[]}
						pendingToolApprovals={chat.pendingApprovals}
						sessionId={session.id}
						status={toChatStatus(chat.runStatus)}
						streamingMessageId={chat.streamingAssistantId}
					/>
				)}
			</div>

			{/* Composer */}
			<div className="border-t border-border/70 bg-background px-4 py-3">
				{expired ? (
					<p className="py-1 text-center text-sm text-muted-foreground">
						This session has expired — its sandbox was shut down. The transcript
						above is read-only; start a new cloud session to continue the work.
					</p>
				) : (
					<div className="mx-auto max-w-3xl">
						<div
							className={cn(
								"flex items-end gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-sm",
								connectionState !== "connected" && "opacity-70",
							)}
						>
							<Textarea
								className="max-h-40 min-h-10 flex-1 resize-none border-0 bg-transparent p-1 text-[15px] shadow-none focus-visible:ring-0"
								disabled={connectionState !== "connected" || sending}
								onChange={(event) => setPromptInput(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter" && !event.shiftKey) {
										event.preventDefault();
										void handleSend();
									}
								}}
								placeholder={
									connectionState === "connected"
										? isRunning
											? "Queue a follow-up message..."
											: "Send a message to this cloud session..."
										: "Waiting for connection..."
								}
								rows={1}
								value={promptInput}
							/>
							<Button
								aria-label="Send"
								className="size-8 shrink-0"
								disabled={!canSend}
								onClick={() => void handleSend()}
								size="icon"
								title="Send"
								type="button"
							>
								{sending ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<ArrowUp className="size-4" />
								)}
							</Button>
						</div>
						{chat.usageTotals && chat.usageTotals.totalCost > 0 ? (
							<p className="mt-1.5 text-right text-[11px] text-muted-foreground">
								{chat.usageTotals.inputTokens.toLocaleString()} in /{" "}
								{chat.usageTotals.outputTokens.toLocaleString()} out · $
								{chat.usageTotals.totalCost.toFixed(4)}
							</p>
						) : null}
					</div>
				)}
			</div>
		</div>
	);
}
