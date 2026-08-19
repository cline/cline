"use client";

import type { DesktopProjection } from "@shared/projection";
import { BugIcon, Plus, RefreshCw } from "lucide-react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { BridgeClient, BridgeStatus } from "@/lib/bridge-client";
import { cn } from "@/lib/utils";

const CONNECTION_LABELS: Record<string, { label: string; className: string }> =
	{
		connecting: {
			label: "Connecting",
			className: "bg-muted text-muted-foreground",
		},
		connected: {
			label: "Connected",
			className: "bg-emerald-600/20 text-emerald-400",
		},
		reconnecting: {
			label: "Reconnecting",
			className: "bg-amber-600/20 text-amber-400",
		},
		incompatible: {
			label: "Incompatible",
			className: "bg-destructive/20 text-destructive",
		},
		unavailable: {
			label: "Gateway unavailable",
			className: "bg-destructive/20 text-destructive",
		},
	};

const OPEN_FOLDER_VALUE = "__open_folder__";

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
	const status =
		CONNECTION_LABELS[connection.state] ?? CONNECTION_LABELS.connecting;

	const onBotChange = useCallback(
		(botId: string) => {
			void client.send({ command: "bot.select", botId }).catch(() => {});
		},
		[client],
	);
	const onWorkspaceChange = useCallback(
		(workspaceId: string) => {
			if (workspaceId === OPEN_FOLDER_VALUE) {
				void client.send({ command: "workspace.open" }).catch(() => {});
				return;
			}
			void client
				.send({ command: "workspace.select", workspaceId })
				.catch(() => {});
		},
		[client],
	);
	const startNewSession = useCallback(async () => {
		await client.send({ command: "session.select" });
		await client.send({ command: "app.initialize" });
	}, [client]);

	return (
		<header
			className="relative flex h-[4.5rem] shrink-0 items-end gap-3 border-b bg-sidebar px-3 pb-2 text-sidebar-foreground"
			data-testid="app-header"
		>
			<div
				className="absolute inset-x-0 top-0 flex h-7 items-center justify-end gap-1 px-2"
				data-tauri-drag-region
			>
				{connection.state === "connected" && connection.sandboxed !== true ? (
					<div
						className="mr-1 size-2 rounded-full bg-amber-400"
						about={connection.executionMode ?? "unsandboxed"}
						title="The Gateway reports development execution: engine runs are not sandboxed."
					/>
				) : (
					<div
						className={cn("mr-1 size-2 rounded-full", status.className)}
						title={bridgeStatus === "fixtures" ? "Fixtures" : status.label}
					/>
				)}
				<Button
					aria-label="Reconnect to the Gateway"
					className="size-7"
					onClick={() =>
						void client.send({ command: "gateway.reconnect" }).catch(() => {})
					}
					size="icon"
					title="Reconnect to the Gateway"
					variant="ghost"
				>
					<RefreshCw aria-hidden className="size-3" />
				</Button>
				<Button
					aria-label="Reveal diagnostics"
					className="size-7"
					disabled={!projection.diagnostics.revealAvailable}
					onClick={() =>
						void client.send({ command: "diagnostics.reveal" }).catch(() => {})
					}
					size="icon"
					title="Reveal the diagnostics folder"
					variant="ghost"
				>
					<BugIcon aria-hidden className="size-3" />
				</Button>
				<Button
					aria-label="New chat"
					className="size-7"
					onClick={() => void startNewSession().catch(() => {})}
					size="icon"
					title="Start a new chat"
					variant="ghost"
				>
					<Plus aria-hidden className="size-4" />
				</Button>
			</div>
			{projection.bots.length > 0 && (
				<Select
					onValueChange={onBotChange}
					value={projection.selectedBotId ?? ""}
				>
					<SelectTrigger
						aria-label="Cline — switch bot"
						className="h-8 w-48 border-0 bg-transparent shadow-none hover:bg-surface-hover"
						size="sm"
					>
						<SelectValue placeholder="Select a bot" />
					</SelectTrigger>
					<SelectContent>
						{projection.bots.map((bot) => (
							<SelectItem key={bot.botId} value={bot.botId}>
								{bot.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			)}
			<div className="flex-1" />
			{projection.workspaces.length > 0 && (
				<div className="flex items-center gap-2">
					<span className="text-xs text-muted-foreground">Workspace</span>
					<Select
						onValueChange={onWorkspaceChange}
						value={projection.selectedWorkspaceId ?? ""}
					>
						<SelectTrigger
							aria-label="Workspace for the next new chat"
							className="h-8 w-56"
							size="sm"
							title="Choose where the next new chat works"
						>
							<SelectValue placeholder="Workspace for the next chat" />
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
							<SelectItem value={OPEN_FOLDER_VALUE}>Open Folder…</SelectItem>
						</SelectContent>
					</Select>
				</div>
			)}
		</header>
	);
}
