"use client";

import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConnectorLogo } from "@/components/views/settings/composio-connectors-view";
import {
	fetchComposioStatus,
	fetchComposioToolkitCatalog,
} from "@/lib/composio";
import { composioLogoUrl } from "@/lib/composio-recipes";
import { findRecommendedToolkit } from "@/lib/composio-types";
import { openExternalUrl } from "@/lib/desktop-client";
import type { ConnectorAuthToolkit } from "./connector-auth";

const CONNECT_POLL_INTERVAL_MS = 3_000;
/** Matches how long the sidecar's own connect flow waits for the browser. */
const CONNECT_WAIT_TIMEOUT_MS = 5 * 60 * 1000;

type ConnectState = "idle" | "waiting" | "connected";

function ConnectorAuthRow({ toolkit }: { toolkit: ConnectorAuthToolkit }) {
	const { slug, redirectUrl } = toolkit;
	const [name, setName] = useState(
		() => findRecommendedToolkit(slug)?.name ?? slug,
	);
	const [state, setState] = useState<ConnectState>(
		redirectUrl ? "idle" : "connected",
	);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			const status = await fetchComposioStatus();
			const entry = status.integrations.find((item) => item.toolkit === slug);
			if (cancelled) return;
			// A transcript reopened after the user connected should not offer
			// the (now spent) link again.
			if (entry?.status === "connected") setState("connected");
			// Status only names recommended and connected toolkits.
			const resolved =
				entry?.name ||
				(await fetchComposioToolkitCatalog()).toolkits.find(
					(item) => item.slug === slug,
				)?.name;
			if (!cancelled && resolved) setName(resolved);
		})().catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [slug]);

	// The link finishes in the external browser, which cannot report back.
	// A refreshing status read imports the new connection (and its tools, for
	// the next session), so poll it until the toolkit shows up as connected.
	useEffect(() => {
		if (state !== "waiting") return;
		let cancelled = false;
		let inFlight = false;
		const deadline = Date.now() + CONNECT_WAIT_TIMEOUT_MS;
		const interval = setInterval(() => {
			if (Date.now() > deadline) {
				setState("idle");
				return;
			}
			if (inFlight) return;
			inFlight = true;
			void fetchComposioStatus({ refresh: true })
				.then((status) => {
					const entry = status.integrations.find(
						(item) => item.toolkit === slug,
					);
					if (!cancelled && entry?.status === "connected") {
						setState("connected");
					}
				})
				.catch(() => {})
				.finally(() => {
					inFlight = false;
				});
		}, CONNECT_POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [slug, state]);

	const openLink = () => {
		if (!redirectUrl) return;
		setState("waiting");
		void openExternalUrl(redirectUrl);
	};

	return (
		<div className="flex w-full max-w-md items-center gap-3 rounded-xl border border-border/70 bg-background/60 px-3 py-2.5">
			<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
				<ConnectorLogo logo={composioLogoUrl(slug)} name={name} slug={slug} />
			</span>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm font-medium text-foreground">
					{name}
				</span>
				<span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
					{state === "waiting" ? (
						<>
							<Loader2 className="size-3 shrink-0 animate-spin" />
							Finish connecting in your browser
						</>
					) : state === "connected" ? (
						"Ready to use in your next chat"
					) : (
						"Not connected"
					)}
				</span>
			</span>
			{state === "connected" ? (
				<span className="flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
					<CheckCircle2 className="size-4" />
					Connected
				</span>
			) : state === "waiting" ? (
				<Button onClick={openLink} size="sm" type="button" variant="ghost">
					Reopen link
				</Button>
			) : (
				<Button onClick={openLink} size="sm" type="button">
					Connect
					<ExternalLink className="size-3.5" />
				</Button>
			)}
		</div>
	);
}

/** In-chat prompt to connect the apps an agent needs (Composio Connect Links). */
export function ConnectorAuthCard({
	toolkits,
}: {
	toolkits: ConnectorAuthToolkit[];
}) {
	return (
		<div className="flex flex-col gap-2 py-1">
			{toolkits.map((toolkit) => (
				<ConnectorAuthRow key={toolkit.slug} toolkit={toolkit} />
			))}
		</div>
	);
}
