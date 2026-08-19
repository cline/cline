"use client";

import { FolderOpen, RefreshCw, ShieldAlert } from "lucide-react";
import { useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { BridgeClient, BridgeStatus } from "@/lib/bridge-client";
import { cn } from "@/lib/utils";
import type { DesktopProjection } from "@shared/projection";

const CONNECTION_LABELS: Record<string, { label: string; className: string }> = {
	connecting: { label: "Connecting", className: "bg-muted text-muted-foreground" },
	connected: { label: "Connected", className: "bg-emerald-600/20 text-emerald-400" },
	reconnecting: { label: "Reconnecting", className: "bg-amber-600/20 text-amber-400" },
	incompatible: { label: "Incompatible", className: "bg-destructive/20 text-destructive" },
	unavailable: { label: "Gateway unavailable", className: "bg-destructive/20 text-destructive" },
};

export function Header({
	client,
	projection,
	bridgeStatus,
}: {
	client: BridgeClient;
	projection: DesktopProjection;
	bridgeStatus: BridgeStatus;
}) {
	const connection = projection.connection;
	const status = CONNECTION_LABELS[connection.state] ?? CONNECTION_LABELS.connecting;

	const onBotChange = useCallback(
		(botId: string) => {
			void client.send({ command: "bot.select", botId }).catch(() => {});
		},
		[client],
	);
	const onWorkspaceChange = useCallback(
		(workspaceId: string) => {
			void client
				.send({ command: "workspace.select", workspaceId })
				.catch(() => {});
		},
		[client],
	);

	return (
		<header
			className="flex h-12 shrink-0 items-center gap-3 border-b px-3"
			data-testid="app-header"
		>
			<span className="text-sm font-semibold tracking-tight">
				Gateway Desktop
			</span>
			<Badge className={cn("border-transparent", status.className)}>
				{bridgeStatus === "fixtures" ? "Fixtures" : status.label}
			</Badge>
			{connection.state === "connected" &&
				connection.sandboxed !== true && (
					<Badge
						className="gap-1 border-transparent bg-amber-500/15 text-amber-400"
						title="The Gateway reports development execution: engine runs are NOT sandboxed. Phase 4 adds real sandbox execution."
					>
						<ShieldAlert aria-hidden className="size-3" />
						{connection.executionMode ?? "development"} mode — unsandboxed
					</Badge>
				)}
			<div className="flex-1" />
			{projection.bots.length > 0 && (
				<Select
					onValueChange={onBotChange}
					value={projection.selectedBotId ?? undefined}
				>
					<SelectTrigger className="h-8 w-44" size="sm">
						<SelectValue placeholder="Select a bot" />
					</SelectTrigger>
					<SelectContent>
						{projection.bots.map((bot) => (
							<SelectItem key={bot.botId} value={bot.botId}>
								{bot.name}
								{bot.isDefaultLead ? " (lead)" : ""}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			)}
			{projection.workspaces.length > 0 && (
				<Select
					onValueChange={onWorkspaceChange}
					value={projection.selectedWorkspaceId ?? undefined}
				>
					<SelectTrigger className="h-8 w-56" size="sm">
						<SelectValue placeholder="Workspace for new sessions" />
					</SelectTrigger>
					<SelectContent>
						{projection.workspaces.map((workspace) => (
							<SelectItem
								key={workspace.workspaceId}
								value={workspace.workspaceId}
							>
								{workspace.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			)}
			<Separator className="h-6" orientation="vertical" />
			<Button
				onClick={() =>
					void client.send({ command: "gateway.reconnect" }).catch(() => {})
				}
				size="sm"
				variant="outline"
			>
				<RefreshCw aria-hidden className="size-3" />
				Reconnect
			</Button>
			<Button
				disabled={!projection.diagnostics.revealAvailable}
				onClick={() =>
					void client.send({ command: "diagnostics.reveal" }).catch(() => {})
				}
				size="sm"
				title="Reveal the diagnostics folder"
				variant="ghost"
			>
				<FolderOpen aria-hidden className="size-3" />
				Diagnostics
			</Button>
		</header>
	);
}
