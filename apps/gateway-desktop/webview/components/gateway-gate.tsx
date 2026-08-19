"use client";

import { Copy, RefreshCw } from "lucide-react";
import { useCallback, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { BridgeClient, BridgeStatus } from "@/lib/bridge-client";
import type { DesktopProjection } from "@shared/projection";

/**
 * Full-screen state when the Gateway cannot be used: missing (visible
 * state with copyable start instructions — the app NEVER starts a
 * Gateway itself), reconnecting, or protocol-incompatible.
 */
export function GatewayGate({
	client,
	projection,
	bridgeStatus,
}: {
	client: BridgeClient;
	projection: DesktopProjection;
	bridgeStatus: BridgeStatus;
}) {
	const connection = projection.connection;
	const [copied, setCopied] = useState(false);
	const instructions = connection.startInstructions ?? "cline-gateway start";
	const copy = useCallback(() => {
		void navigator.clipboard.writeText(instructions).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1_500);
		});
	}, [instructions]);

	if (bridgeStatus === "disconnected") {
		return (
			<main className="flex flex-1 items-center justify-center p-8">
				<Card className="w-full max-w-lg">
					<CardHeader>
						<CardTitle>Native bridge disconnected</CardTitle>
						<CardDescription>
							The window lost its broker process. It reconnects
							automatically; running Gateway work is unaffected.
						</CardDescription>
					</CardHeader>
				</Card>
			</main>
		);
	}

	return (
		<main className="flex flex-1 items-center justify-center p-8">
			<Card className="w-full max-w-lg" data-testid="gateway-gate">
				<CardHeader>
					<CardTitle>
						{connection.state === "incompatible"
							? "Gateway protocol incompatible"
							: connection.state === "reconnecting"
								? "Reconnecting to the Gateway…"
								: connection.state === "connecting"
									? "Connecting to the Gateway…"
									: "Gateway is not running"}
					</CardTitle>
					<CardDescription>
						{connection.state === "incompatible"
							? "The running Gateway speaks a protocol this client does not support. Update Gateway Desktop or the Gateway; nothing is retried automatically."
							: connection.state === "unavailable"
								? "Gateway Desktop never starts, stops, or replaces a Gateway. Start it yourself, then reconnect:"
								: "Waiting for the local Gateway. Runs in progress are owned by the Gateway and continue without this window."}
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					{connection.state === "unavailable" && (
						<div className="relative">
							<pre className="gwd-selectable overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-5">
								{instructions}
							</pre>
							<Button
								className="absolute top-2 right-2"
								onClick={copy}
								size="xs"
								variant="outline"
							>
								<Copy aria-hidden className="size-3" />
								{copied ? "Copied" : "Copy"}
							</Button>
						</div>
					)}
					{connection.lastError && (
						<Alert variant="destructive">
							<AlertTitle>{connection.lastError.code}</AlertTitle>
							<AlertDescription className="gwd-selectable">
								{connection.lastError.message}
								{connection.lastError.correlationId
									? ` (correlation ${connection.lastError.correlationId})`
									: ""}
							</AlertDescription>
						</Alert>
					)}
					{connection.state !== "incompatible" && (
						<Button
							onClick={() =>
								void client
									.send({ command: "gateway.reconnect" })
									.catch(() => {})
							}
							variant="default"
						>
							<RefreshCw aria-hidden className="size-3" />
							Reconnect now
						</Button>
					)}
				</CardContent>
			</Card>
		</main>
	);
}
