"use client";

import { Check, ExternalLink, Loader2 } from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConnectorLogo } from "@/components/views/settings/composio-connectors-view";
import { fetchComposioStatus } from "@/lib/composio";
import { COMPOSIO_RECIPES, composioLogoUrl } from "@/lib/composio-recipes";
import type { ComposioIntegrationSummary } from "@/lib/composio-types";
import { findRecommendedToolkit } from "@/lib/composio-types";
import { openExternalUrl } from "@/lib/desktop-client";
import { cn } from "@/lib/utils";
import type { ConnectorLink } from "./connector-links";

/** The OAuth flow finishes in the external browser, which cannot navigate
 * the app back, so after the user opens the link the card reconciles with
 * Composio until the connection lands. Connect Links expire after ten
 * minutes, so the wait gives up then too. */
const WAIT_POLL_INTERVAL_MS = 4_000;
const WAIT_TIMEOUT_MS = 10 * 60 * 1000;

function connectorDisplayName(slug: string): string {
	const recipeName = COMPOSIO_RECIPES.flatMap(
		(recipe) => recipe.connectors,
	).find((connector) => connector.slug === slug)?.name;
	return (
		findRecommendedToolkit(slug)?.name ??
		recipeName ??
		slug.charAt(0).toUpperCase() + slug.slice(1)
	);
}

/**
 * Follows one toolkit's connection state: on mount a local read (instant)
 * followed by one reconciliation with Composio (a toolkit connected on
 * another device, or from a link in another session, is only known
 * remotely), then repeated reconciliation while the user is finishing the
 * browser flow.
 */
function useConnectorSummary(toolkit: string, waiting: boolean) {
	const [summary, setSummary] = useState<ComposioIntegrationSummary>();
	const connected = summary?.status === "connected";
	const load = useCallback(
		async (refresh: boolean) => {
			const status = await fetchComposioStatus(
				refresh ? { refresh: true } : undefined,
			);
			return status.integrations.find(
				(integration) => integration.toolkit === toolkit,
			);
		},
		[toolkit],
	);
	useEffect(() => {
		let cancelled = false;
		const apply = (next: ComposioIntegrationSummary | undefined) => {
			if (!cancelled && next) setSummary(next);
		};
		load(false)
			.then(apply, noop)
			.then(() => (cancelled ? undefined : load(true)))
			.then(apply, noop);
		return () => {
			cancelled = true;
		};
	}, [load]);
	useEffect(() => {
		if (!waiting || connected) return;
		let cancelled = false;
		let inFlight = false;
		const deadline = Date.now() + WAIT_TIMEOUT_MS;
		const interval = setInterval(() => {
			if (inFlight) return;
			if (Date.now() > deadline) {
				clearInterval(interval);
				return;
			}
			inFlight = true;
			load(true)
				.then((next) => {
					if (!cancelled && next) setSummary(next);
				}, noop)
				.finally(() => {
					inFlight = false;
				});
		}, WAIT_POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [load, waiting, connected]);
	return summary;
}

function noop() {}

const ConnectorConnectCard = memo(function ConnectorConnectCard({
	link,
}: {
	link: ConnectorLink;
}) {
	const [waiting, setWaiting] = useState(false);
	const summary = useConnectorSummary(link.toolkit, waiting);
	const connected = summary?.status === "connected";
	// The status falls back to the bare slug when the catalog has not loaded.
	const name =
		summary?.name && summary.name !== link.toolkit
			? summary.name
			: connectorDisplayName(link.toolkit);
	const description =
		summary?.description || findRecommendedToolkit(link.toolkit)?.description;

	return (
		<div
			className="flex w-full max-w-md items-center gap-3 rounded-xl border border-border/70 bg-card p-3"
			data-testid="connector-connect-card"
		>
			<span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
				<ConnectorLogo
					className="size-6"
					logo={summary?.logo ?? composioLogoUrl(link.toolkit)}
					name={name}
					slug={link.toolkit}
				/>
			</span>
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm font-medium text-foreground">
					{name}
				</div>
				<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
					{waiting && !connected ? (
						<Loader2 className="size-3 shrink-0 animate-spin" />
					) : null}
					<span className="line-clamp-2">
						{connected
							? "Connected · tools are available in new sessions"
							: waiting
								? `Finish connecting ${name} in your browser…`
								: (description ?? `Connect your ${name} account to Cline.`)}
					</span>
				</div>
			</div>
			{connected ? (
				<span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs font-medium text-foreground">
					<Check className="size-3.5 text-primary" />
					Connected
				</span>
			) : (
				<Button
					className={cn(waiting && "text-muted-foreground")}
					onClick={() => {
						setWaiting(true);
						void openExternalUrl(link.redirectUrl);
					}}
					size="sm"
					type="button"
					variant={waiting ? "outline" : "default"}
				>
					Connect
					<ExternalLink className="size-3.5" />
				</Button>
			)}
		</div>
	);
});

/** One card per Connect Link the agent handed to the user. */
export const ConnectorConnectCards = memo(function ConnectorConnectCards({
	links,
}: {
	links: ConnectorLink[];
}) {
	return (
		<div className="flex flex-col gap-2 py-1">
			{links.map((link) => (
				<ConnectorConnectCard key={link.toolkit} link={link} />
			))}
		</div>
	);
});
