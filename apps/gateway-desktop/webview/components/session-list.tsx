"use client";

import { MessageSquarePlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { BridgeClient } from "@/lib/bridge-client";
import { cn } from "@/lib/utils";
import type { DesktopProjection } from "@shared/projection";

const ACTIVITY_STYLES: Record<string, string> = {
	running: "bg-emerald-600/20 text-emerald-400",
	queued: "bg-amber-600/20 text-amber-400",
	idle: "bg-muted text-muted-foreground",
	closed: "bg-muted text-muted-foreground line-through",
};

export function SessionList({
	client,
	projection,
}: {
	client: BridgeClient;
	projection: DesktopProjection;
}) {
	const sessions = projection.sessions.filter(
		(session) =>
			!projection.selectedBotId || session.botId === projection.selectedBotId,
	);
	return (
		<div className="flex min-h-0 flex-1 flex-col" data-testid="session-list">
			<div className="flex items-center justify-between px-3 py-2">
				<span className="text-xs font-medium text-muted-foreground uppercase">
					Sessions
				</span>
				<Button
					onClick={() =>
						void client.send({ command: "session.select" }).catch(() => {})
					}
					size="xs"
					title="Compose a prompt to create a new session lazily"
					variant="ghost"
				>
					<MessageSquarePlus aria-hidden className="size-3" />
					New
				</Button>
			</div>
			<ScrollArea className="min-h-0 flex-1">
				<div className="flex flex-col gap-1 px-2 pb-2">
					{sessions.length === 0 && (
						<p className="px-2 py-6 text-center text-xs text-muted-foreground">
							No sessions yet. The first prompt creates one.
						</p>
					)}
					{sessions.map((session) => (
						<button
							className={cn(
								"flex flex-col gap-1 rounded-md border border-transparent px-2 py-2 text-left hover:bg-surface-hover",
								session.sessionId === projection.selectedSessionId &&
									"border-border bg-surface-hover",
							)}
							key={session.sessionId}
							onClick={() =>
								void client
									.send({
										command: "session.select",
										sessionId: session.sessionId,
									})
									.catch(() => {})
							}
							type="button"
						>
							<span className="truncate font-mono text-xs">
								{session.sessionId}
							</span>
							<span className="flex items-center gap-2">
								<Badge
									className={cn(
										"border-transparent text-[10px]",
										ACTIVITY_STYLES[session.activity] ?? ACTIVITY_STYLES.idle,
									)}
								>
									{session.activity}
								</Badge>
								{session.lastRunState && (
									<span className="text-[10px] text-muted-foreground">
										last run: {session.lastRunState}
									</span>
								)}
							</span>
						</button>
					))}
				</div>
			</ScrollArea>
		</div>
	);
}
