"use client";

import { Loader2, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ComposioIntegrationSummary } from "@/lib/composio-types";
import { useComposioConnections } from "@/lib/use-composio-connections";
import {
	ConnectorActionButton,
	ConnectorLogo,
} from "./composio-connector-browser";

/** Installed connectors and active installations; browse new apps in Marketplace. */
export function ComposioConnectorsView({
	onChanged,
	onOpenMarketplace,
}: {
	onChanged?: () => void;
	onOpenMarketplace?: () => void;
}) {
	const {
		status,
		configured,
		loadError,
		actionError,
		busyToolkit,
		connect,
		cancelConnect,
		disconnect,
	} = useComposioConnections({ onChanged });

	if (loadError) {
		return (
			<p className="text-sm text-destructive" role="alert">
				Failed to load connectors: {loadError}
			</p>
		);
	}

	if (!status) {
		return (
			<output
				aria-label="Loading connectors"
				className="flex items-center justify-center py-16"
			>
				<Loader2 className="size-6 animate-spin text-muted-foreground" />
			</output>
		);
	}

	if (!configured) {
		// Also shown while status loads or after beta access is removed.
		return (
			<p className="text-sm text-muted-foreground">
				Connectors aren&apos;t available.
			</p>
		);
	}

	const installed = status.integrations.filter(
		(integration) => integration.status !== "not_connected",
	);
	const marketplaceButton = onOpenMarketplace ? (
		<Button
			onClick={onOpenMarketplace}
			size="sm"
			type="button"
			variant="default"
		>
			<Store className="size-4" />
			See more Connectors in the Marketplace
		</Button>
	) : null;

	if (installed.length === 0) {
		return (
			<div className="flex min-h-64 items-center justify-center">
				{marketplaceButton}
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<p className="text-sm text-muted-foreground">
				Connected tools become available in new sessions.
			</p>
			<div className="flex flex-col gap-3">
				{installed.map((integration) => (
					<ConnectorCard
						actionError={
							actionError?.toolkit === integration.toolkit
								? actionError.message
								: undefined
						}
						busy={busyToolkit === integration.toolkit}
						configured={configured}
						integration={integration}
						key={integration.toolkit}
						logo={integration.logo}
						onCancel={() => void cancelConnect(integration.toolkit)}
						onConnect={() => void connect(integration.toolkit)}
						onDisconnect={() => void disconnect(integration.toolkit)}
					/>
				))}
			</div>
			{marketplaceButton ? <div>{marketplaceButton}</div> : null}
		</div>
	);
}

function ConnectorCard({
	integration,
	logo,
	configured,
	actionError,
	busy,
	onConnect,
	onCancel,
	onDisconnect,
}: {
	integration: ComposioIntegrationSummary;
	logo?: string;
	configured: boolean;
	/** Already scoped by the caller to THIS card's connector. */
	actionError?: string;
	busy: boolean;
	onConnect: () => void;
	onCancel: () => void;
	onDisconnect: () => void;
}) {
	const toolNames = integration.toolNames ?? [];
	return (
		<div className="rounded-2xl border border-border/70 bg-background/60 p-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-3">
					<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
						<ConnectorLogo
							logo={logo}
							name={integration.name}
							slug={integration.toolkit}
						/>
					</span>
					<div>
						<p className="text-sm font-semibold text-foreground">
							{integration.name}
						</p>
						{integration.description ? (
							<p className="mt-0.5 text-xs text-muted-foreground">
								{integration.description}
							</p>
						) : null}
					</div>
				</div>
				<ConnectorActionButton
					busy={busy}
					configured={configured}
					onCancel={onCancel}
					onConnect={onConnect}
					onDisconnect={onDisconnect}
					showUninstall
					status={integration.status}
					variant="default"
				/>
			</div>

			{integration.status === "pending" ? (
				<p className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" />
					Finish authorizing {integration.name} in your browser…
				</p>
			) : null}

			{(actionError ?? integration.error) ? (
				<p className="mt-2 text-xs text-destructive" role="alert">
					{actionError ?? integration.error}
				</p>
			) : null}

			{integration.status === "connected" && toolNames.length > 0 ? (
				<details className="mt-3 border-t border-border/70 pt-3">
					<summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground">
						{toolNames.length} tool{toolNames.length === 1 ? "" : "s"} available
						in new sessions
					</summary>
					<ul className="mt-2 flex flex-wrap gap-1.5">
						{toolNames.map((name) => (
							<li key={name}>
								<Badge className="font-normal" variant="outline">
									{name}
								</Badge>
							</li>
						))}
					</ul>
				</details>
			) : null}
		</div>
	);
}
