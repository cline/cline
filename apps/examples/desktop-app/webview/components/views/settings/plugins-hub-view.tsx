"use client";

import { Store } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
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
 * installed. "Browse directory" opens the marketplace directory as a modal on
 * top of the page, so installed items and the marketplace live in one place
 * without swapping the page out from under the user.
 */

type PluginsHubTab = "plugins" | "apps" | "mcp" | "skills";

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
	const [directoryOpen, setDirectoryOpen] = useState(false);
	const [counts, setCounts] = useState<HubCounts>({});
	// Bumped when the marketplace modal installed/uninstalled something so the
	// active tab remounts and refetches its inventory after the modal closes.
	const [inventoryVersion, setInventoryVersion] = useState(0);
	const [directoryMutated, setDirectoryMutated] = useState(false);
	// Ref mirror of directoryOpen: install/uninstall completions can arrive
	// after the modal content unmounted with a stale closure, so the handler
	// must read the current open state, not the one captured at render time.
	const directoryOpenRef = useRef(false);

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

	// Marketplace installs/uninstalls happen outside the per-tab views, so the
	// shared inventory cache must be dropped for the installed tabs to refetch.
	// When the completion lands after the modal was already closed (install
	// still in flight while closing), remount the active tab right away
	// instead of waiting for another open/close cycle.
	const handleDirectoryChanged = useCallback(() => {
		invalidateExtensionInventoryCache();
		void refreshCounts();
		if (directoryOpenRef.current) {
			setDirectoryMutated(true);
		} else {
			setInventoryVersion((version) => version + 1);
		}
	}, [refreshCounts]);

	const handleDirectoryOpenChange = useCallback(
		(open: boolean) => {
			directoryOpenRef.current = open;
			setDirectoryOpen(open);
			if (!open && directoryMutated) {
				setDirectoryMutated(false);
				setInventoryVersion((version) => version + 1);
			}
		},
		[directoryMutated],
	);

	return (
		<PageFrame>
			<PageHeader
				description="Manage plugins, apps, MCP servers, and skills. Browse the marketplace to install more."
				title="Plugins"
				actions={
					<Button
						onClick={() => handleDirectoryOpenChange(true)}
						type="button"
						variant="outline"
					>
						<Store className="size-4" />
						Browse Marketplace
					</Button>
				}
			/>

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

			<div key={inventoryVersion}>
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
			</div>

			<Dialog onOpenChange={handleDirectoryOpenChange} open={directoryOpen}>
				<DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-4xl">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Store className="size-5 text-primary" />
							Marketplace
						</DialogTitle>
						<DialogDescription>
							Install plugins, MCP servers, and skills from the Cline
							marketplace.
						</DialogDescription>
					</DialogHeader>
					{/* Padding (offset by negative margins) keeps the inputs' focus
					    rings from being clipped by the scroll container edges. */}
					<div className="-mx-2 -mt-2 min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-1">
						<MarketplaceView
							chrome="embedded"
							defaultTypeFilter={TAB_TO_PRIMITIVE[tab]}
							onInstalledItemsChanged={handleDirectoryChanged}
							variant="directory"
						/>
					</div>
				</DialogContent>
			</Dialog>
		</PageFrame>
	);
}
