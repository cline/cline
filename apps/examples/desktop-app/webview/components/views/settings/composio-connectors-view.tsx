"use client";

import { Loader2, Store } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchComposioToolkitCatalog } from "@/lib/composio";
import type { ComposioIntegrationSummary } from "@/lib/composio-types";
import { useComposioConnections } from "@/lib/use-composio-connections";
import {
	ConnectorActionButton,
	ConnectorLogo,
} from "./composio-connector-browser";

/**
 * Installed > Connectors: the connected accounts. Gmail, Google Calendar,
 * and GitHub are pinned as recommended; the full catalog is browsed from the
 * Marketplace's Connectors tab. The Composio API key comes from the
 * sidecar's COMPOSIO_API_KEY environment variable — there is nothing
 * key-related to manage here, and the whole tab is hidden without one.
 */

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

	// Official logos come from the Composio catalog; summaries only carry one
	// once a toolkit is connected, so join the catalog for the rest.
	const [logoBySlug, setLogoBySlug] = useState<Map<string, string>>(
		() => new Map(),
	);

	useEffect(() => {
		if (!configured) {
			return;
		}
		let cancelled = false;
		void fetchComposioToolkitCatalog()
			.then((response) => {
				if (cancelled) {
					return;
				}
				const next = new Map<string, string>();
				for (const entry of response.toolkits) {
					if (entry.logo) {
						next.set(entry.slug, entry.logo);
					}
				}
				setLogoBySlug(next);
			})
			.catch(() => {
				// Logos are cosmetic; the themed fallback icons cover this.
			});
		return () => {
			cancelled = true;
		};
	}, [configured]);

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
		// Normally unreachable — the Connectors tab is hidden without a managed
		// key — but reachable transiently while status loads.
		return (
			<p className="text-sm text-muted-foreground">
				Connectors aren&apos;t available.
			</p>
		);
	}

	const recommended = status.integrations.filter(
		(integration) => integration.recommended,
	);
	const otherConnected = status.integrations.filter(
		(integration) =>
			!integration.recommended && integration.status !== "not_connected",
	);

	return (
		<div className="flex flex-col gap-6">
			<div>
				<p className="text-sm text-muted-foreground">
					Connect your accounts to give Cline tools for your favorite apps.
					Connected tools become available in new sessions.
				</p>
			</div>

			{actionError ? (
				<p className="text-xs text-destructive" role="alert">
					{actionError.message}
				</p>
			) : null}

			<section>
				<h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					Recommended
				</h3>
				<div className="flex flex-col gap-3">
					{recommended.map((integration) => (
						<ConnectorCard
							busy={busyToolkit === integration.toolkit}
							configured={configured}
							integration={integration}
							key={integration.toolkit}
							logo={integration.logo ?? logoBySlug.get(integration.toolkit)}
							onCancel={() => void cancelConnect(integration.toolkit)}
							onConnect={() => void connect(integration.toolkit)}
							onDisconnect={() => void disconnect(integration.toolkit)}
						/>
					))}
				</div>
			</section>

			{otherConnected.length > 0 ? (
				<section>
					<h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Also connected
					</h3>
					<div className="flex flex-col gap-3">
						{otherConnected.map((integration) => (
							<ConnectorCard
								busy={busyToolkit === integration.toolkit}
								configured={configured}
								integration={integration}
								key={integration.toolkit}
								logo={integration.logo ?? logoBySlug.get(integration.toolkit)}
								onCancel={() => void cancelConnect(integration.toolkit)}
								onConnect={() => void connect(integration.toolkit)}
								onDisconnect={() => void disconnect(integration.toolkit)}
							/>
						))}
					</div>
				</section>
			) : null}

			{onOpenMarketplace ? (
				<div>
					<Button
						onClick={onOpenMarketplace}
						size="sm"
						type="button"
						variant="outline"
					>
						<Store className="size-4" />
						Browse all connectors in the Marketplace
					</Button>
				</div>
			) : null}
		</div>
	);
}

function ConnectorCard({
	integration,
	logo,
	configured,
	busy,
	onConnect,
	onCancel,
	onDisconnect,
}: {
	integration: ComposioIntegrationSummary;
	logo?: string;
	configured: boolean;
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

			{integration.error ? (
				<p className="mt-2 text-xs text-destructive" role="alert">
					{integration.error}
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
