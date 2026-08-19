"use client";

import { useEffect, useMemo, useState } from "react";
import { ApprovalList } from "@/components/approval-list";
import { Composer } from "@/components/composer";
import { Conversation } from "@/components/conversation";
import { GatewayGate } from "@/components/gateway-gate";
import { Header } from "@/components/header";
import { SessionList } from "@/components/session-list";
import { BridgeClient, type BridgeState } from "@/lib/bridge-client";
import {
	createInitialProjection,
	type DesktopProjection,
} from "@shared/projection";

export function AppShell() {
	const [state, setState] = useState<BridgeState>({
		status: "connecting",
		projection: createInitialProjection(),
	});
	const client = useMemo(
		() => new BridgeClient(BridgeClient.fixtureFromLocation()),
		[],
	);

	useEffect(() => {
		const unsubscribe = client.subscribe(setState);
		client.start();
		return () => {
			unsubscribe();
			client.stop();
		};
	}, [client]);

	const projection: DesktopProjection = state.projection;
	const gatewayReady = projection.connection.state === "connected";

	return (
		<div className="flex h-screen flex-col bg-background text-foreground">
			<Header client={client} projection={projection} bridgeStatus={state.status} />
			{gatewayReady ? (
				<div className="flex min-h-0 flex-1">
					<aside className="flex w-64 shrink-0 flex-col border-r">
						<SessionList client={client} projection={projection} />
					</aside>
					<main className="flex min-w-0 flex-1 flex-col">
						<Conversation client={client} projection={projection} />
						<ApprovalList client={client} projection={projection} />
						<Composer client={client} projection={projection} />
					</main>
				</div>
			) : (
				<GatewayGate client={client} projection={projection} bridgeStatus={state.status} />
			)}
		</div>
	);
}
