import { Button, EmptyState } from "@cline/ui";

import { ConnectorLogo } from "@/components/connectors/connector-logo";
import { Spinner } from "@/components/ui/spinner";
import { marketplaceEntryKey as entryKey } from "@/lib/marketplace-entry";
import { cn } from "@/lib/utils";
import { PageCardGrid } from "../../shared/page-card-grid";
import { ConnectorCatalogView } from "../connectors/composio-connectors-view";
import { AddMcpServerButton } from "../mcp/add-mcp-server-button";
import {
	CustomizeSectionHeading,
	CustomizeViewAllButton,
} from "../shared/customize-section-heading";
import { usePrimaryButtonRefs } from "../shared/use-primary-button-refs";
import { MarketplaceCard } from "./marketplace-card";
import {
	entryActionLabel,
	entryFailureStatus,
	isEntryActionBusy,
} from "./marketplace-entry-action";
import { TYPE_META } from "./marketplace-type-meta";
import type { useMarketplaceResults } from "./use-marketplace-results";

const BROWSE_PREVIEW_LIMIT = 6;

/** Shared catalog rendering. Browse and search own their surrounding navigation. */
export function MarketplaceResults({
	model,
	onCreateMcp,
}: {
	model: ReturnType<typeof useMarketplaceResults>;
	/** Browse offers adding a server by hand; search results do not. */
	onCreateMcp?: (trigger?: HTMLButtonElement) => void;
}) {
	const primaryButtons = usePrimaryButtonRefs();
	const {
		directory,
		pendingInlineInstalls,
		openDetails,
		query,
		typeFilter,
		isBrowseOverview,
		viewAll,
		connectorSearchState,
		connectorModel,
		connectorAvailabilityError,
		showConnectors,
		groups,
		connectorSearchReady,
		hideEmptyConnectors,
		searchResults,
	} = model;
	return (
		<div className={cn("grid min-w-0 gap-4")}>
			{typeFilter !== "connector" && directory.loading ? (
				<p className="flex items-center justify-center p-6 text-muted-foreground text-sm">
					<Spinner className="mr-2" />
					Loading marketplace…
				</p>
			) : null}
			{typeFilter !== "connector" && directory.errorMessage ? (
				<p className="p-4 text-error-text text-sm" role="alert">
					{directory.errorMessage}
				</p>
			) : null}
			{searchResults && directory.installedError ? (
				<p className="text-error-text text-sm" role="alert">
					Unable to check installed customizations: {directory.installedError}
				</p>
			) : null}
			{searchResults && connectorAvailabilityError ? (
				<p className="text-error-text text-sm" role="alert">
					Unable to load connectors.
				</p>
			) : null}
			{showConnectors && !hideEmptyConnectors ? (
				<section className="grid gap-4" aria-label="Connectors">
					<ConnectorCatalogView
						catalogHeader={
							!searchResults ? (
								<CustomizeSectionHeading
									count={
										!isBrowseOverview &&
										connectorSearchReady &&
										!connectorSearchState?.loading &&
										!connectorSearchState?.error
											? connectorSearchState?.count
											: undefined
									}
									actions={
										isBrowseOverview ? (
											<CustomizeViewAllButton
												onClick={() => viewAll("connector")}
											/>
										) : undefined
									}
									headingLevel={3}
									size="lg"
									title={TYPE_META.connector.plural}
								/>
							) : undefined
						}
						searchResults={searchResults}
						model={connectorModel}
						catalogPreview={
							isBrowseOverview
								? {
										limit: BROWSE_PREVIEW_LIMIT,
										onViewAll: () => viewAll("connector"),
									}
								: undefined
						}
						searchQuery={query}
						renderItem={({
							entry,
							status,
							onOpenDetails,
							primaryRef,
							selected,
							actions,
						}) => (
							<MarketplaceCard
								actions={actions}
								name={entry.name}
								primaryRef={primaryRef}
								description={entry.description}
								glyph={
									<ConnectorLogo
										className="size-6 rounded-md"
										logo={entry.logo}
										name={entry.name}
										slug={entry.slug}
									/>
								}
								meta={TYPE_META.connector}
								installed={status === "connected"}
								selected={selected}
								onSelect={onOpenDetails}
							/>
						)}
					/>
				</section>
			) : null}
			{groups.map((group) => {
				const meta = TYPE_META[group.type];
				return (
					<div className="grid min-w-0 gap-4" key={group.type}>
						{!searchResults ? (
							<CustomizeSectionHeading
								count={
									isBrowseOverview ||
									directory.loading ||
									directory.errorMessage
										? undefined
										: group.entries.length
								}
								actions={
									group.type === "mcp" ? (
										<AddMcpServerButton onCreateMcp={onCreateMcp} />
									) : undefined
								}
								onViewAll={
									isBrowseOverview ? () => viewAll(group.type) : undefined
								}
								headingLevel={3}
								size="lg"
								title={meta.plural}
							/>
						) : null}
						<PageCardGrid>
							{(isBrowseOverview
								? group.entries.slice(0, BROWSE_PREVIEW_LIMIT)
								: group.entries
							).map((entry) => {
								const key = entryKey(entry);
								const installed = directory.installedKeys.has(key);
								const state = directory.actionStates.get(key);
								const failureStatus = entryFailureStatus(state);
								const busy = isEntryActionBusy(state);
								return (
									<MarketplaceCard
										name={entry.name}
										primaryRef={primaryButtons.ref(key)}
										description={entry.tagline}
										authorName={entry.author?.name}
										meta={TYPE_META[entry.type]}
										verified={entry.verified}
										installed={installed}
										status={failureStatus}
										selected={false}
										actions={
											!installed || busy ? (
												<Button
													size="xs"
													variant="secondary"
													tone="neutral"
													aria-label={`Install ${entry.name}`}
													disabled={!directory.installedReady || busy}
													onClick={(event) => {
														pendingInlineInstalls.current.set(key, {
															entry,
															trigger:
																primaryButtons.get(key) ?? event.currentTarget,
														});
														void directory.install(entry);
													}}
													loading={busy || !directory.installedReady}
												>
													{entryActionLabel(
														state,
														false,
														directory.installedReady,
													)}
												</Button>
											) : undefined
										}
										key={key}
										entryKey={key}
										onSelect={(event) =>
											openDetails(entry, event.currentTarget)
										}
									/>
								);
							})}
						</PageCardGrid>
					</div>
				);
			})}
			{!searchResults &&
			groups.every((group) => group.entries.length === 0) &&
			(!showConnectors || hideEmptyConnectors) &&
			!directory.loading &&
			!directory.errorMessage ? (
				<EmptyState>No entries match the current filters.</EmptyState>
			) : null}
		</div>
	);
}
