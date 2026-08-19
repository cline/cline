"use client";

import { CircleAlert, RotateCcw, Square, Wrench } from "lucide-react";
import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { BridgeClient } from "@/lib/bridge-client";
import { createClientRequestId } from "@/lib/composer";
import { cn } from "@/lib/utils";
import type { DesktopProjection, MessageProjection } from "@shared/projection";

function MessageBubble({ message }: { message: MessageProjection }) {
	const isUser = message.role === "user";
	return (
		<div
			className={cn(
				"flex flex-col gap-1",
				isUser ? "items-end" : "items-start",
			)}
		>
			<span className="text-[10px] text-muted-foreground uppercase">
				{message.role}
			</span>
			<div
				className={cn(
					"gwd-selectable max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
					isUser
						? "bg-primary text-primary-foreground"
						: "border bg-card text-card-foreground",
				)}
			>
				{message.text || "(no text content)"}
				{message.truncated && (
					<span className="mt-1 block text-[10px] text-muted-foreground italic">
						content truncated for display
					</span>
				)}
			</div>
		</div>
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
	const bottomRef = useRef<HTMLDivElement>(null);
	const messageCount = active?.messages.length ?? 0;
	const streamingLength = active?.streaming?.text.length ?? 0;

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new content, not on ref identity
	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messageCount, streamingLength]);

	if (!active) {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center p-6">
				<p className="max-w-sm text-center text-sm text-muted-foreground">
					No session selected. Type a prompt below — the first accepted prompt
					creates the session lazily with the workspace chosen in the header.
				</p>
			</div>
		);
	}

	const currentRun = active.currentRun;
	const running = currentRun?.state === "running";

	return (
		<div className="flex min-h-0 flex-1 flex-col" data-testid="conversation">
			<div className="flex items-center gap-2 border-b px-4 py-2">
				<span className="truncate font-mono text-xs text-muted-foreground">
					{active.sessionId}
				</span>
				{currentRun && (
					<>
						<Badge
							className={cn(
								"border-transparent text-[10px]",
								running
									? "bg-emerald-600/20 text-emerald-400"
									: currentRun.state === "failed" ||
											currentRun.state === "interrupted"
										? "bg-destructive/20 text-destructive"
										: "bg-muted text-muted-foreground",
							)}
							data-testid="current-run-state"
						>
							{currentRun.state}
							{currentRun.attempt > 1 ? ` · attempt ${currentRun.attempt}` : ""}
						</Badge>
						<span className="truncate font-mono text-[10px] text-muted-foreground">
							{currentRun.runId}
						</span>
						{currentRun.provenance && currentRun.provenance.mode !== "interactive" && (
							<Badge
								className={cn(
									"border-transparent text-[10px]",
									currentRun.provenance.mode === "automation"
										? "bg-sky-600/20 text-sky-400"
										: "bg-violet-600/20 text-violet-400",
								)}
								data-testid="run-provenance"
								title={
									currentRun.provenance.scheduleId ??
									currentRun.provenance.connectorId ??
									currentRun.provenance.submittedBy ??
									""
								}
							>
								{currentRun.provenance.mode}
								{currentRun.provenance.scheduleId
									? ` · ${currentRun.provenance.scheduleId.slice(0, 12)}…`
									: currentRun.provenance.connectorId
										? ` · ${currentRun.provenance.connectorId.slice(0, 12)}…`
										: ""}
							</Badge>
						)}
					</>
				)}
				{active.usage && (
					<span className="text-[10px] text-muted-foreground">
						{active.usage.inputTokens}↑ {active.usage.outputTokens}↓
					</span>
				)}
				<div className="flex-1" />
				{running && currentRun && (
					<Button
						onClick={() =>
							void client
								.send({
									command: "run.interrupt",
									clientRequestId: createClientRequestId(),
									runId: currentRun.runId,
								})
								.catch(() => {})
						}
						size="sm"
						variant="destructive"
					>
						<Square aria-hidden className="size-3" />
						Interrupt
					</Button>
				)}
				{currentRun?.retryable && (
					<Button
						data-testid="retry-run"
						onClick={() =>
							void client
								.send({
									command: "run.retry",
									clientRequestId: createClientRequestId(),
									runId: currentRun.runId,
								})
								.catch(() => {})
						}
						size="sm"
						variant="outline"
					>
						<RotateCcw aria-hidden className="size-3" />
						Retry (same run, new attempt)
					</Button>
				)}
			</div>
			<ScrollArea className="min-h-0 flex-1">
				<div className="flex flex-col gap-4 p-4">
					{active.messages.map((message) => (
						<MessageBubble key={message.id} message={message} />
					))}
					{active.streaming && (
						<div className="flex flex-col items-start gap-1">
							<span className="text-[10px] text-muted-foreground uppercase">
								assistant · streaming
							</span>
							<div className="gwd-selectable max-w-[80%] rounded-lg border bg-card px-3 py-2 text-sm whitespace-pre-wrap">
								{active.streaming.text}
								<span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-foreground/70" />
							</div>
						</div>
					)}
					{active.tools.length > 0 && (
						<div className="flex flex-wrap gap-2">
							{active.tools.map((tool) => (
								<Badge
									className={cn(
										"gap-1 border-transparent text-[10px]",
										tool.state === "running"
											? "bg-amber-600/20 text-amber-400"
											: tool.state === "error"
												? "bg-destructive/20 text-destructive"
												: "bg-muted text-muted-foreground",
									)}
									key={tool.toolCallId}
								>
									<Wrench aria-hidden className="size-3" />
									{tool.toolName} · {tool.state}
								</Badge>
							))}
						</div>
					)}
					{currentRun?.error && (
						<div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
							<CircleAlert
								aria-hidden
								className="mt-0.5 size-3.5 text-destructive"
							/>
							<div className="gwd-selectable">
								<p className="font-medium text-destructive">
									{currentRun.error.name}
								</p>
								<p className="text-muted-foreground">
									{currentRun.error.message}
								</p>
							</div>
						</div>
					)}
					{active.queuedTurns.length > 0 && (
						<div className="flex flex-col gap-1 rounded-md border border-dashed p-3">
							<span className="text-[10px] font-medium text-muted-foreground uppercase">
								Queued turns (FIFO)
							</span>
							{active.queuedTurns.map((turn) => (
								<div className="flex items-center gap-2" key={turn.runId}>
									<span className="truncate font-mono text-[10px] text-muted-foreground">
										{turn.runId}
									</span>
									<span className="truncate text-xs">{turn.promptPreview}</span>
								</div>
							))}
						</div>
					)}
					<div ref={bottomRef} />
				</div>
			</ScrollArea>
		</div>
	);
}
