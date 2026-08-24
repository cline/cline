"use client";

import { Store } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { desktopClient } from "@/lib/desktop-client";
import { cn } from "@/lib/utils";
import { PageFrame, PageHeader } from "../page-layout";
import { CustomizationSectionView } from "./extensions-view";
import { McpServersContent } from "./mcp-view";

/**
 * Unified Plugins hub: one page for everything installed (plugins, MCP
 * servers, skills) with sub-tabs and live counts. The "Browse Marketplace"
 * button navigates to the dedicated Marketplace settings page.
 */

type PluginsHubTab = "plugins" | "mcp" | "skills";

const HUB_TABS: { id: PluginsHubTab; label: string }[] = [
	{ id: "plugins", label: "Plugins" },
	{ id: "mcp", label: "MCP" },
	{ id: "skills", label: "Skills" },
];

type HubCounts = Partial<Record<PluginsHubTab, number>>;

type HubInventoryResponse = {
	plugins?: unknown[];
	skills?: unknown[];
	workflows?: unknown[];
	mcp?: { servers?: unknown[] };
};

function asCount(value: unknown): number {
	return Array.isArray(value) ? value.length : 0;
}

export function PluginsHubView({
	onOpenMarketplace,
}: {
	onOpenMarketplace?: () => void;
}) {
	const [tab, setTab] = useState<PluginsHubTab>("plugins");
	const [counts, setCounts] = useState<HubCounts>({});

	const refreshCounts = useCallback(async () => {
		const inventory = await desktopClient
			.invoke<HubInventoryResponse>("list_user_instruction_configs")
			.catch(() => null);
		if (!inventory) {
			return;
		}
		setCounts({
			plugins: asCount(inventory.plugins),
			skills: asCount(inventory.skills) + asCount(inventory.workflows),
			mcp: asCount(inventory.mcp?.servers),
		});
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

	return (
		<PageFrame>
			<PageHeader
				description="Manage installed plugins, MCP servers, and skills. Browse the marketplace to install more."
				title="Plugins"
				actions={
					onOpenMarketplace ? (
						<Button onClick={onOpenMarketplace} type="button" variant="outline">
							<Store className="size-4" />
							Browse Marketplace
						</Button>
					) : undefined
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

			{tab === "plugins" ? (
				<CustomizationSectionView
					catalogPrimitive="plugin"
					chrome="embedded"
					marketplaceVariant="installed"
					onInventoryChanged={handleInventoryChanged}
					section="Plugins"
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
		</PageFrame>
	);
}
