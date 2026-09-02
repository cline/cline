"use client";

import { Store } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchComposioStatus } from "@/lib/composio";
import { desktopClient } from "@/lib/desktop-client";
import { cn } from "@/lib/utils";
import { PageFrame, PageHeader } from "../page-layout";
import { ComposioConnectorsView } from "./composio-connectors-view";
import {
	CustomizationSectionView,
	type GenerateMediaToolConfig,
	invalidateExtensionInventoryCache,
} from "./extensions-view";
import { McpServersContent } from "./mcp-view";

/**
 * Unified Customize hub: the installed inventory of everything that extends
 * Cline — skills, MCP servers, plugins, rules, hooks, and tools — as sub-tabs
 * with live counts. Browsing happens on the dedicated Marketplace page,
 * reached from the sidebar or the header button here.
 */

type CustomizeTab =
	| "skills"
	| "mcp"
	| "integrations"
	| "plugins"
	| "rules"
	| "hooks"
	| "tools";

const CUSTOMIZE_TABS: { id: CustomizeTab; label: string }[] = [
	{ id: "skills", label: "Skills" },
	{ id: "mcp", label: "MCP" },
	{ id: "plugins", label: "Plugins" },
	{ id: "rules", label: "Rules" },
	{ id: "hooks", label: "Hooks" },
	{ id: "tools", label: "Tools" },
	{ id: "integrations", label: "Connectors" },
];

type TabCounts = Partial<Record<CustomizeTab, number>>;

type HubInventoryResponse = {
	plugins?: unknown[];
	skills?: unknown[];
	workflows?: unknown[];
	rules?: unknown[];
	hooks?: unknown[];
	tools?: unknown[];
	mcp?: { servers?: unknown[] };
};

function asCount(value: unknown): number {
	return Array.isArray(value) ? value.length : 0;
}

export function CustomizeView({
	generateMediaConfig,
	onOpenMarketplace,
}: {
	generateMediaConfig?: GenerateMediaToolConfig;
	onOpenMarketplace?: () => void;
}) {
	const [tab, setTab] = useState<CustomizeTab>("skills");
	const [counts, setCounts] = useState<TabCounts>({});
	// Connectors are an org-provisioned feature: the tab only exists when the
	// sidecar has a managed Composio API key.
	const [connectorsAvailable, setConnectorsAvailable] = useState(false);

	const refreshCounts = useCallback(async () => {
		const [inventory, composioStatus] = await Promise.all([
			desktopClient
				.invoke<HubInventoryResponse>("list_user_instruction_configs")
				.catch(() => null),
			fetchComposioStatus().catch(() => null),
		]);
		setConnectorsAvailable(composioStatus?.configured === true);
		const connectedIntegrations = composioStatus
			? composioStatus.integrations.filter(
					(integration) => integration.status === "connected",
				).length
			: undefined;
		if (!inventory) {
			if (connectedIntegrations !== undefined) {
				setCounts((previous) => ({
					...previous,
					integrations: connectedIntegrations,
				}));
			}
			return;
		}
		setCounts({
			skills: asCount(inventory.skills) + asCount(inventory.workflows),
			mcp: asCount(inventory.mcp?.servers),
			integrations: connectedIntegrations,
			plugins: asCount(inventory.plugins),
			rules: asCount(inventory.rules),
			hooks: asCount(inventory.hooks),
			tools: asCount(inventory.tools),
		});
	}, []);

	useEffect(() => {
		const timeoutId = window.setTimeout(() => {
			void refreshCounts();
		}, 0);
		return () => window.clearTimeout(timeoutId);
	}, [refreshCounts]);

	useEffect(
		() =>
			desktopClient.subscribe("settings.changed", () => {
				invalidateExtensionInventoryCache();
				void refreshCounts();
			}),
		[refreshCounts],
	);

	const handleInventoryChanged = useCallback(() => {
		void refreshCounts();
	}, [refreshCounts]);

	return (
		<PageFrame>
			<PageHeader
				actions={
					onOpenMarketplace ? (
						<Button
							onClick={onOpenMarketplace}
							size="sm"
							type="button"
							variant="outline"
						>
							<Store className="size-4" />
							Marketplace
						</Button>
					) : undefined
				}
				description="Extend what Cline can do and change how it works. Manage what's installed, or browse the marketplace for more options."
				title="Customize"
			/>

			<div className="mb-6 flex items-center gap-0 border-b border-border">
				{CUSTOMIZE_TABS.filter(
					(customizeTab) =>
						customizeTab.id !== "integrations" || connectorsAvailable,
				).map((customizeTab) => {
					const count = counts[customizeTab.id];
					const active = tab === customizeTab.id;
					return (
						<Button
							aria-current={active ? "page" : undefined}
							className={cn(
								"relative rounded-none px-4 py-2.5 text-sm font-medium transition-colors",
								active
									? "text-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
							key={customizeTab.id}
							onClick={() => setTab(customizeTab.id)}
							type="button"
							variant="ghost"
						>
							{customizeTab.label}
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

			{tab === "skills" ? (
				<CustomizationSectionView
					catalogPrimitive="skill"
					chrome="embedded"
					marketplaceVariant="installed"
					onInventoryChanged={handleInventoryChanged}
					section="Skills"
				/>
			) : tab === "mcp" ? (
				<McpServersContent
					chrome="embedded"
					marketplaceVariant="installed"
					onInventoryChanged={handleInventoryChanged}
				/>
			) : tab === "integrations" ? (
				<ComposioConnectorsView
					onChanged={handleInventoryChanged}
					onOpenMarketplace={onOpenMarketplace}
				/>
			) : tab === "plugins" ? (
				<CustomizationSectionView
					catalogPrimitive="plugin"
					chrome="embedded"
					marketplaceVariant="installed"
					onInventoryChanged={handleInventoryChanged}
					section="Plugins"
				/>
			) : tab === "rules" ? (
				<CustomizationSectionView
					chrome="embedded"
					onInventoryChanged={handleInventoryChanged}
					section="Rules"
				/>
			) : tab === "hooks" ? (
				<CustomizationSectionView
					chrome="embedded"
					onInventoryChanged={handleInventoryChanged}
					section="Hooks"
				/>
			) : (
				<CustomizationSectionView
					chrome="embedded"
					generateMediaConfig={generateMediaConfig}
					onInventoryChanged={handleInventoryChanged}
					section="Tools"
				/>
			)}
		</PageFrame>
	);
}
