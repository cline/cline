"use client";
import { Banner, Button, Dialog, IconButton } from "@cline/ui";
import { Plus, RefreshCw, Server } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import type { McpServer } from "@/lib/extension-inventory";
import type { MarketplaceEntry } from "@/lib/marketplace";
import {
	getInstalledMcpServers,
	mcpMarketplaceItem,
} from "../extensions/installed-marketplace-selectors";
import { InstalledMarketplaceItems } from "../marketplace/installed-marketplace-items";
import type {
	MarketplaceLocalInstalledItem,
	MarketplaceLocalInstalledItemRenderContext,
} from "../marketplace/installed-marketplace-types";
import { MarketplaceEntrySetupDetails } from "../marketplace/marketplace-entry-setup";
import type { InstalledMarketplaceModel } from "../marketplace/use-installed-marketplace-items";
import {
	CustomizationCategorySection,
	useCustomizationCategoryDialog,
} from "../shared/customization-category-section";
import { CustomizationDescription } from "../shared/customization-description";
import { CustomizationItemCard } from "../shared/customization-item-card";
import { CustomizationTypeBadge } from "../shared/customization-type-badge";
import { useCustomizeRefresh } from "../shared/customize-refresh";
import { CustomizeSectionHeading } from "../shared/customize-section-heading";
import { usePrimaryButtonRefs } from "../shared/use-primary-button-refs";
import {
	McpServerConnectionDetails,
	McpServerDeleteDialog,
	McpServerManagementActions,
	McpServerStatus,
	McpServerToggle,
} from "./mcp-server-controls";
import type { InstalledMcpSelection } from "./mcp-types";
import { useMcpServers } from "./use-mcp-servers";

type McpServersContentProps = {
	marketplaceModel: InstalledMarketplaceModel;
	includeBuiltinItems?: boolean;
	/** Invoked whenever the server list is (re)loaded or mutated. */
	onInventoryChanged?: () => void;
	searchQuery?: string;
	searchResults?: boolean;
	previewLimit?: number;
	itemOffset?: number;
	onViewAll?: () => void;
	onCreateMcp: (trigger?: HTMLButtonElement) => void;
	onOpenMcp: (
		selection: InstalledMcpSelection,
		trigger?: HTMLButtonElement,
	) => void;
};

function useMcpServersController(onInventoryChanged?: () => void) {
	const [dialogSelection, setDialogSelection] = useState<{
		name: string;
		entry?: MarketplaceEntry;
	} | null>(null);
	const categoryDialog = useCustomizationCategoryDialog(() =>
		setDialogSelection(null),
	);
	const cardReturnFocusRef = useRef<HTMLButtonElement | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<McpServer | null>(null);
	const state = useMcpServers({
		onInventoryChanged,
		onActionError: (name) => {
			// A mutation may finish after the user opened another server. Keep its
			// error on the originating card rather than opening a hidden list's portal.
			if (cardReturnFocusRef.current?.closest("[hidden]")) return;
			setDialogSelection((current) => ({
				name,
				entry: current?.name === name ? current.entry : undefined,
			}));
		},
		onServerSaved: (name, previousName) => {
			if (previousName === undefined) return;
			setDialogSelection((current) =>
				current?.name === previousName ? { ...current, name } : current,
			);
		},
	});
	return {
		dialogSelection,
		setDialogSelection,
		categoryDialog,
		cardReturnFocusRef,
		deleteTarget,
		setDeleteTarget,
		state,
	};
}

export function McpServersContent({
	marketplaceModel,
	includeBuiltinItems = true,
	onInventoryChanged,
	searchQuery,
	searchResults = false,
	onOpenMcp,
	onCreateMcp,
	previewLimit,
	itemOffset,
	onViewAll,
}: McpServersContentProps) {
	const controller = useMcpServersController(onInventoryChanged);
	const sortedServers = useMemo(
		() => getInstalledMcpServers(controller.state.servers, includeBuiltinItems),
		[controller.state.servers, includeBuiltinItems],
	);
	const primaryButtons = usePrimaryButtonRefs();
	const {
		dialogSelection,
		setDialogSelection,
		categoryDialog,
		cardReturnFocusRef,
		deleteTarget,
		setDeleteTarget,
		state,
	} = controller;
	const {
		servers,
		hasSettingsFile,
		isLoading,
		errorMessage,
		serverActionErrors,
		busyServerName,
		authorizingServerName,
		refreshServers,
		toggleServer,
		deleteServer,
		authorizeOAuth,
		cancelOAuth,
	} = state;
	const openEditor = (server: McpServer) => {
		const entry =
			dialogSelection?.name === server.name ? dialogSelection.entry : undefined;
		setDialogSelection(null);
		onOpenMcp({ server, entry }, cardReturnFocusRef.current ?? undefined);
	};
	const searchCount = marketplaceModel.summary.count;
	const searchLoading = isLoading || marketplaceModel.summary.loading;
	const searchError = Boolean(errorMessage) || marketplaceModel.summary.error;

	const renderServerCard = (
		server: McpServer,
		context?: MarketplaceLocalInstalledItemRenderContext,
	) => {
		const matchedEntry = context?.matchedEntries?.find(
			(entry) => entry.type === "mcp",
		);
		const isAuthorizing = authorizingServerName === server.name;
		const needsAuthentication = Boolean(
			server.oauthStatus?.authorizationRequired || isAuthorizing,
		);

		return (
			<CustomizationItemCard
				key={server.name}
				onClickCapture={() => {
					cardReturnFocusRef.current = primaryButtons.get(server.name) ?? null;
				}}
				title={server.name}
				description={matchedEntry?.tagline}
				authorName={matchedEntry?.author?.name}
				status={
					busyServerName === server.name
						? undefined
						: server.configurationError
							? "invalid-configuration"
							: needsAuthentication
								? undefined
								: (serverActionErrors[server.name]?.status ??
									(!server.disabled && server.oauthStatus?.lastError
										? "connection-error"
										: undefined))
				}
				primaryAction={{
					ref: primaryButtons.ref(server.name),
					label: `View ${server.name} details`,
					onClick: (event) => {
						// Pending card actions belong to this inventory instance. Keep
						// their status/cancellation here until the editor can take over.
						if (busyServerName !== server.name && !isAuthorizing) {
							onOpenMcp({ server, entry: matchedEntry }, event.currentTarget);
						} else {
							setDialogSelection({ name: server.name, entry: matchedEntry });
						}
					},
				}}
				icon={Server}
				actions={
					needsAuthentication ? (
						<Button
							size="xs"
							variant="secondary"
							tone="neutral"
							aria-label={`Authenticate ${server.name}`}
							aria-busy={isAuthorizing}
							disabled={
								busyServerName === server.name || authorizingServerName !== null
							}
							onClick={(event) => {
								event.stopPropagation();
								void authorizeOAuth(server.name);
							}}
						>
							{isAuthorizing ? "Authenticating…" : "Authenticate"}
						</Button>
					) : (
						<McpServerToggle
							server={server}
							busy={busyServerName === server.name}
							onToggle={toggleServer}
						/>
					)
				}
			/>
		);
	};

	const installedItems = sortedServers.map(
		(server): MarketplaceLocalInstalledItem => ({
			...mcpMarketplaceItem(server),
			render: (context) => renderServerCard(server, context),
		}),
	);

	const handleRefresh = useCallback(
		() => refreshServers(true),
		[refreshServers],
	);
	const sharedRefresh = useCustomizeRefresh(handleRefresh);
	const headerActions = (
		<>
			{!sharedRefresh ? (
				<IconButton
					aria-label="Refresh MCP servers"
					variant="ghost"
					tone="neutral"
					size="sm"
					onClick={() => void handleRefresh()}
					disabled={isLoading}
					icon={RefreshCw}
					loading={isLoading}
					loadingIcon={RefreshCw}
				/>
			) : null}
			<Button
				size="sm"
				onClick={(event) => onCreateMcp(event.currentTarget)}
				tone="neutral"
				leadingIcon={Plus}
			>
				Add MCP server
			</Button>
		</>
	);
	const inventoryCount = searchLoading || searchError ? undefined : searchCount;
	const dialogServer = servers.find(
		(server) => server.name === dialogSelection?.name,
	);

	return (
		<div>
			{!searchResults && (
				<CustomizeSectionHeading
					className="mb-4"
					title="MCP"
					description={
						hasSettingsFile
							? "Editing this list updates cline_mcp_settings.json."
							: "No MCP settings file found yet. Add a server to create it."
					}
					count={inventoryCount}
					headingLevel={3}
					onViewAll={onViewAll}
					actions={headerActions}
				/>
			)}
			{errorMessage && (
				<Banner tone="error" className="mb-4">
					{errorMessage}
				</Banner>
			)}
			<InstalledMarketplaceItems
				model={marketplaceModel}
				emptyAction={{
					label: "Add MCP server",
					onClick: (event) => onCreateMcp(event.currentTarget),
				}}
				previewLimit={previewLimit}
				itemOffset={itemOffset}
				installedItems={installedItems}
				onInstalledItemsChanged={() => refreshServers()}
				primitive="mcp"
				searchQuery={searchQuery}
				searchResults={searchResults}
				showInstalledHeading={false}
				onOpenMcp={(entry, trigger) => onOpenMcp({ entry }, trigger)}
			/>
			<Dialog
				open={Boolean(dialogServer)}
				onCloseAutoFocus={(event) => {
					categoryDialog.onCloseAutoFocus(event);
					if (event.defaultPrevented) return;
					if (cardReturnFocusRef.current?.isConnected) {
						event.preventDefault();
						cardReturnFocusRef.current.focus({ preventScroll: true });
					}
				}}
				onOpenChange={(open) => {
					if (!open) setDialogSelection(null);
				}}
				size="md"
				title={dialogServer?.name ?? "MCP server"}
				description={
					dialogSelection?.entry?.tagline ? (
						<CustomizationDescription>
							{dialogSelection.entry.tagline}
						</CustomizationDescription>
					) : undefined
				}
				footer={
					dialogServer ? (
						<>
							<McpServerToggle
								server={dialogServer}
								busy={busyServerName === dialogServer.name}
								onToggle={toggleServer}
							/>
							<McpServerManagementActions
								server={dialogServer}
								busy={busyServerName === dialogServer.name}
								authorizing={authorizingServerName === dialogServer.name}
								onEdit={openEditor}
								onDelete={setDeleteTarget}
								full
							/>
						</>
					) : undefined
				}
			>
				{dialogServer ? (
					<div className="grid gap-4">
						<CustomizationTypeBadge
							className="justify-self-start"
							type="mcp"
							onSelected={categoryDialog.onSelected}
						/>
						<McpServerStatus
							server={dialogServer}
							actionError={serverActionErrors[dialogServer.name]}
							busy={busyServerName === dialogServer.name}
							authorizing={authorizingServerName === dialogServer.name}
							onAuthorize={authorizeOAuth}
							onCancel={cancelOAuth}
						/>
						<McpServerConnectionDetails server={dialogServer} />
						<CustomizationCategorySection
							categories={dialogSelection?.entry?.tags ?? []}
							onSelected={categoryDialog.onSelected}
						/>
						{dialogSelection?.entry ? (
							<MarketplaceEntrySetupDetails entries={[dialogSelection.entry]} />
						) : null}
					</div>
				) : null}
			</Dialog>
			<McpServerDeleteDialog
				server={deleteTarget}
				busy={busyServerName !== null}
				onClose={() => setDeleteTarget(null)}
				onDelete={deleteServer}
			/>
		</div>
	);
}
