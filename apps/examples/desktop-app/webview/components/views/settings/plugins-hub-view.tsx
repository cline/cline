"use client";

import { ArrowLeft, Store } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { desktopClient } from "@/lib/desktop-client";
import type { MarketplacePrimitiveType } from "@/lib/marketplace";
import { cn } from "@/lib/utils";
import { MarketplaceView } from "../marketplace-view";
import { PageFrame, PageHeader } from "../page-layout";
import { ChannelsContent } from "./channels-view";
import {
	CustomizationSectionView,
	invalidateExtensionInventoryCache,
} from "./extensions-view";
import { McpServersContent } from "./mcp-view";

/**
 * Unified Plugins hub: one page for everything installable/connectable
 * (plugins, apps/channels, MCP servers, skills) with sub-tabs showing what is
 * installed, plus a "Browse directory" mode that swaps the same page to the
 * full marketplace directory. Keeps installed vs. marketplace in one place.
 */

type PluginsHubTab = "plugins" | "apps" | "mcp" | "skills";
type PluginsHubMode = "installed" | "directory";

const HUB_TABS: { id: PluginsHubTab; label: string }[] = [
	{ id: "plugins", label: "Plugins" },
	{ id: "apps", label: "Apps" },
	{ id: "mcp", label: "MCP" },
	{ id: "skills", label: "Skills" },
];

// Apps (connector channels) have no marketplace catalog entries, so the
// directory opens unfiltered when entered from that tab.
const TAB_TO_PRIMITIVE: Partial<
	Record<PluginsHubTab, MarketplacePrimitiveType>
> = {
	plugins: "plugin",
	mcp: "mcp",
	skills: "skill",
};

type HubCounts = Partial<Record<PluginsHubTab, number>>;

type HubInventoryResponse = {
	plugins?: unknown[];
	skills?: unknown[];
	workflows?: unknown[];
	mcp?: { servers?: unknown[] };
};

type HubChannelsResponse = {
	active?: Array<{ type?: string }>;
};

function asCount(value: unknown): number {
	return Array.isArray(value) ? value.length : 0;
}

export function PluginsHubView() {
	const [tab, setTab] = useState<PluginsHubTab>("plugins");
	const [mode, setMode] = useState<PluginsHubMode>("installed");
	const [counts, setCounts] = useState<HubCounts>({});

	const refreshCounts = useCallback(async () => {
		const [inventory, channels] = await Promise.all([
			desktopClient
				.invoke<HubInventoryResponse>("list_user_instruction_configs")
				.catch(() => null),
			desktopClient
				.invoke<HubChannelsResponse>("list_connector_channels")
				.catch(() => null),
		]);
		setCounts((current) => ({
			...current,
			...(inventory
				? {
						plugins: asCount(inventory.plugins),
						skills: asCount(inventory.skills) + asCount(inventory.workflows),
						mcp: asCount(inventory.mcp?.servers),
					}
				: {}),
			...(channels
				? {
						apps: new Set(
							(Array.isArray(channels.active) ? channels.active : [])
								.map((connector) => connector?.type)
								.filter(Boolean),
						).size,
					}
				: {}),
		}));
	}, []);

	useEffect(() => {
		const timeoutId = window.setTimeout(() => {
			void refreshCounts();
		}, 0);
		return () => window.clearTimeout(timeoutId);
	}, [refreshCounts]);

	const handleInventoryChanged = useCallback(() => {
		void refreshCounts();
	}, [refreshCounts]);

	// Directory installs/uninstalls happen outside the per-tab views, so the
	// shared inventory cache must be dropped for the installed tabs to refetch
	// when the user switches back.
	const handleDirectoryChanged = useCallback(() => {
		invalidateExtensionInventoryCache();
		void refreshCounts();
	}, [refreshCounts]);

	return (
		<PageFrame>
			<PageHeader
				description="Manage plugins, apps, MCP servers, and skills. Browse the directory to install more."
				title="Plugins"
				actions={
					mode === "installed" ? (
						<Button
							onClick={() => setMode("directory")}
							type="button"
							variant="outline"
						>
							<Store className="size-4" />
							Browse directory
						</Button>
					) : (
						<Button
							onClick={() => setMode("installed")}
							type="button"
							variant="outline"
						>
							<ArrowLeft className="size-4" />
							Back to installed
						</Button>
					)
				}
			/>

			{mode === "installed" ? (
				<>
					<div className="mb-6 flex items-center gap-0 border-b border-border">
						{HUB_TABS.map((hubTab) => {
							const count = counts[hubTab.id];
							const active = tab === hubTab.id;
							return (
								<Button
									aria-current={active ? "page" : undefined}
									className={cn(
										"relative rounded-none px-4 py-2.5 text-sm font-medium transition-colors",
										active
											? "text-foreground"
											: "text-muted-foreground hover:text-foreground",
									)}
									key={hubTab.id}
									onClick={() => setTab(hubTab.id)}
									type="button"
									variant="ghost"
								>
									{hubTab.label}
									{typeof count === "number" ? (
										<span
											className={cn(
												"text-xs tabular-nums",
												active
													? "text-muted-foreground"
													: "text-muted-foreground/70",
											)}
										>
											{count}
										</span>
									) : null}
									{active ? (
										<span className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground" />
									) : null}
								</Button>
							);
						})}
					</div>

					{tab === "plugins" ? (
						<CustomizationSectionView
							catalogPrimitive="plugin"
							chrome="embedded"
							marketplaceVariant="installed"
							onInventoryChanged={handleInventoryChanged}
							section="Plugins"
						/>
					) : tab === "apps" ? (
						<ChannelsContent
							chrome="embedded"
							onInventoryChanged={handleInventoryChanged}
						/>
					) : tab === "mcp" ? (
						<McpServersContent
							chrome="embedded"
							onInventoryChanged={handleInventoryChanged}
						/>
					) : (
						<CustomizationSectionView
							catalogPrimitive="skill"
							chrome="embedded"
							marketplaceVariant="installed"
							onInventoryChanged={handleInventoryChanged}
							section="Skills"
						/>
					)}
				</>
			) : (
				<MarketplaceView
					chrome="embedded"
					defaultTypeFilter={TAB_TO_PRIMITIVE[tab]}
					onInstalledItemsChanged={handleDirectoryChanged}
					variant="directory"
				/>
			)}
		</PageFrame>
	);
}
