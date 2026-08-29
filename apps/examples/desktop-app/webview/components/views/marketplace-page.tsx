"use client";

import { Blocks } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MarketplaceView } from "./marketplace-view";
import { PageFrame, PageHeader } from "./page-layout";
import { ComposioConnectorBrowser } from "./settings/composio-connector-browser";

/**
 * The Marketplace destination page: the community catalog of plugins, MCP
 * servers, and skills ("Browse") plus the Composio connector directory
 * ("Connectors") as sub-tabs.
 */

type MarketplaceTab = "browse" | "connectors";

const MARKETPLACE_TABS: { id: MarketplaceTab; label: string }[] = [
	{ id: "browse", label: "Browse" },
	{ id: "connectors", label: "Connectors" },
];

export function MarketplacePage({
	onOpenInstalled,
}: {
	/** Navigate to Installed (Customize), also where the Composio key lives. */
	onOpenInstalled?: () => void;
}) {
	const [tab, setTab] = useState<MarketplaceTab>("browse");

	return (
		<PageFrame>
			<PageHeader
				actions={
					onOpenInstalled ? (
						<Button
							onClick={onOpenInstalled}
							size="sm"
							type="button"
							variant="outline"
						>
							<Blocks className="size-4" />
							Installed
						</Button>
					) : undefined
				}
				description="A curated set of plugins, MCP servers, skills, and connectors from the Cline community."
				title="Marketplace"
			/>

			<div className="mb-6 flex items-center gap-0 border-b border-border">
				{MARKETPLACE_TABS.map((marketplaceTab) => {
					const active = tab === marketplaceTab.id;
					return (
						<Button
							aria-current={active ? "page" : undefined}
							className={cn(
								"relative rounded-none px-4 py-2.5 text-sm font-medium transition-colors",
								active
									? "text-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
							key={marketplaceTab.id}
							onClick={() => setTab(marketplaceTab.id)}
							type="button"
							variant="ghost"
						>
							{marketplaceTab.label}
							{active ? (
								<span className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground" />
							) : null}
						</Button>
					);
				})}
			</div>

			{tab === "browse" ? (
				<MarketplaceView chrome="embedded" variant="directory" />
			) : (
				<ComposioConnectorBrowser onOpenSetup={onOpenInstalled} />
			)}
		</PageFrame>
	);
}
