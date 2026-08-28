"use client";

import type { DesktopProjection } from "@shared/projection";
import { BugIcon, Plus, RefreshCw } from "lucide-react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
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
			<div className="flex-1" />
		</header>
	);
}
