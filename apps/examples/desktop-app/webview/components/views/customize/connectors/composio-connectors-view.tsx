"use client";

import { Badge, Button, EmptyState, IconButton } from "@cline/ui";
import { Loader2, RefreshCw } from "lucide-react";
import { type ReactNode, type Ref, useEffect, useRef, useState } from "react";

import { COMPOSIO_RECIPES } from "@/lib/composio-recipes";
import type {
	ComposioCatalogToolkit,
	ComposioIntegrationStatus,
	ComposioToolkitSlug,
} from "@/lib/composio-types";
import { useComposioConnections } from "@/lib/use-composio-connections";
import { PageCardGrid } from "../../shared/page-card-grid";
import { findScrollViewport } from "../../shared/page-scroll";
import { CustomizationEmptyState } from "../shared/customization-empty-state";
import { useCustomizeRefresh } from "../shared/customize-refresh";
import { CustomizeSectionHeading } from "../shared/customize-section-heading";
import { usePrimaryButtonRefs } from "../shared/use-primary-button-refs";
import { ConnectorCardAction } from "./connector-action-button";
import { ConnectorCard } from "./connector-card";
import { ConnectorDetailDialog } from "./connector-detail-dialog";
import { RecipeCard } from "./connector-recipe-card";
import { ConnectorsUnavailable } from "./connectors-unavailable";
import type { ConnectorResults } from "./use-connector-results";

/** How many catalog entries each scroll to the end of the list adds. */
const CATALOG_PAGE_SIZE = 24;

const ACTION_FAILURE_STATUS = {
	connect: "connection-error",
	cancel: "action-failed",
	disconnect: "disconnect-failed",
} as const;

/**
 * What the installed list and the catalog share: connecting from a card, each
 * connector's own failure, and the details dialog that a card or a failed
 * action opens.
 */
function useConnectorActions(model: ConnectorResults) {
	const {
		actionError,
		busyToolkit,
		refreshing,
		refresh,
		connect,
		cancelConnect,
		disconnect,
	} = useComposioConnections();
	const sharedRefresh = useCustomizeRefresh(refresh);
	const { catalog, installedEntries, statusBySlug } = model;

	const [detailSlug, setDetailSlug] = useState<ComposioToolkitSlug | null>(
		null,
	);
	const connectionTrigger = useRef<{
		slug: ComposioToolkitSlug;
		primary: HTMLButtonElement | null;
	} | null>(null);
	const connectFromCard = (
		slug: ComposioToolkitSlug,
		trigger?: HTMLButtonElement,
	) => {
		connectionTrigger.current = {
			slug,
			primary: trigger ?? null,
		};
		// Connect disappears while browser authorization is pending.
		connectionTrigger.current.primary?.focus({ preventScroll: true });
		void connect(slug);
	};
	const openDetails = (slug: ComposioToolkitSlug) => {
		connectionTrigger.current = null;
		setDetailSlug(slug);
	};
	useEffect(() => {
		if (actionError) {
			const trigger = connectionTrigger.current;
			if (
				trigger?.slug === actionError.toolkit &&
				trigger.primary?.isConnected
			) {
				// The failed action disappears; let the dialog capture the stable card opener.
				trigger.primary.focus({ preventScroll: true });
			}
			connectionTrigger.current = null;
			setDetailSlug(actionError.toolkit);
		}
	}, [actionError]);

	/** A failed action belongs only to the connector it was for. */
	const failedActionOf = (slug: ComposioToolkitSlug | null) =>
		slug !== null && actionError?.toolkit === slug ? actionError : undefined;
	/** The state a card shows for one connector. */
	const connectionOf = (slug: ComposioToolkitSlug) => {
		const failedAction = failedActionOf(slug);
		const status: ComposioIntegrationStatus =
			statusBySlug.get(slug)?.status ?? "not_connected";
		return {
			busy: busyToolkit === slug,
			status,
			failureStatus: failedAction
				? ACTION_FAILURE_STATUS[failedAction.operation]
				: undefined,
			error: failedAction?.message ?? statusBySlug.get(slug)?.error,
		};
	};

	// The catalog entry carries categories and tool counts the status
	// payload lacks, so prefer it even for installed connectors.
	const detailEntry = detailSlug
		? (catalog?.find((entry) => entry.slug === detailSlug) ??
			installedEntries.find((entry) => entry.slug === detailSlug) ?? {
				slug: detailSlug,
				name:
					statusBySlug.get(detailSlug)?.name ??
					COMPOSIO_RECIPES.flatMap((recipe) => recipe.connectors).find(
						(connector) => connector.slug === detailSlug,
					)?.name ??
					detailSlug,
				description: statusBySlug.get(detailSlug)?.description,
				recommended: statusBySlug.get(detailSlug)?.recommended ?? false,
			})
		: null;
	const detailFailure = failedActionOf(detailSlug);
	const detailDialog = (
		<ConnectorDetailDialog
			failureStatus={
				detailFailure
					? ACTION_FAILURE_STATUS[detailFailure.operation]
					: undefined
			}
			actionError={detailFailure?.message}
			busy={detailSlug !== null && busyToolkit === detailSlug}
			entry={detailEntry}
			onCancel={() => {
				if (detailSlug) {
					void cancelConnect(detailSlug);
				}
			}}
			onConnect={() => {
				if (detailSlug) {
					void connect(detailSlug);
				}
			}}
			onDisconnect={() => {
				if (detailSlug) {
					void disconnect(detailSlug);
				}
			}}
			onOpenChange={(open) => {
				if (!open) {
					setDetailSlug(null);
				}
			}}
			summary={detailSlug ? statusBySlug.get(detailSlug) : undefined}
		/>
	);

	return {
		busyToolkit,
		refreshing,
		refresh,
		sharedRefresh,
		cancelConnect,
		detailSlug,
		connectFromCard,
		openDetails,
		connectionOf,
		detailDialog,
	};
}

/** Shown in place of a list until the account's connector status is known. */
function ConnectorsPending({
	heading,
	loadError,
}: {
	heading: ReactNode;
	loadError: string | null;
}) {
	return (
		<div className="grid gap-4">
			{heading}
			{loadError ? (
				<p className="select-text text-error-text text-sm" role="alert">
					Failed to load connectors: {loadError}
				</p>
			) : (
				<output
					aria-label="Loading connectors"
					className="flex items-center justify-center py-16"
				>
					<Loader2 className="size-6 animate-spin text-muted-foreground" />
				</output>
			)}
		</div>
	);
}

function RefreshFailedNotice({ loadError }: { loadError: string | null }) {
	return loadError ? (
		<p className="text-error-text text-xs" role="alert">
			Failed to refresh connectors: {loadError}
		</p>
	) : null;
}

function CatalogErrorNotice({
	error,
	onRetry,
}: {
	error: string | null;
	onRetry: () => unknown;
}) {
	return error ? (
		<div className="flex flex-wrap items-center gap-3">
			<p className="text-error-text text-xs" role="alert">
				{error}
			</p>
			<Button
				onClick={() => void onRetry()}
				size="sm"
				tone="neutral"
				type="button"
				variant="secondary"
			>
				Retry
			</Button>
		</div>
	) : null;
}

/** The connectors an account has connected or is connecting. */
export function InstalledConnectorsView({
	model,
	searchQuery = "",
	searchResults = false,
	onViewAll,
	previewLimit,
	itemOffset = 0,
}: {
	model: ConnectorResults;
	/** The host page's search text, as typed. */
	searchQuery?: string;
	/** Return result cards and errors without a heading or an empty state. */
	searchResults?: boolean;
	onViewAll?: () => void;
	previewLimit?: number;
	itemOffset?: number;
}) {
	const {
		refreshing,
		refresh,
		sharedRefresh,
		detailSlug,
		connectFromCard,
		openDetails,
		connectionOf,
		detailDialog,
	} = useConnectorActions(model);
	const {
		status,
		configured,
		loadError,
		catalogError,
		installedEntries,
		matchingInstalled,
		category,
		trimmedQuery,
		refreshCatalog,
	} = model;

	const heading = searchResults ? null : (
		<CustomizeSectionHeading
			title="Connectors"
			count={
				status && !loadError
					? category
						? matchingInstalled.length
						: installedEntries.length
					: undefined
			}
			headingLevel={3}
			onViewAll={onViewAll}
			actions={
				configured && !sharedRefresh ? (
					<IconButton
						aria-label="Refresh connectors"
						disabled={refreshing}
						onClick={() => void refresh()}
						size="sm"
						tone="neutral"
						type="button"
						variant="ghost"
						icon={RefreshCw}
						loading={refreshing}
						loadingIcon={RefreshCw}
					/>
				) : null
			}
		/>
	);

	if (!status)
		return <ConnectorsPending heading={heading} loadError={loadError} />;
	if (!configured) {
		if (searchResults) return null;
		return (
			<div className="grid gap-4">
				{heading}
				<ConnectorsUnavailable onRefresh={refresh} refreshing={refreshing} />
			</div>
		);
	}

	const cards = (
		<PageCardGrid>
			{matchingInstalled
				.slice(
					itemOffset,
					previewLimit === undefined ? undefined : itemOffset + previewLimit,
				)
				.map((entry) => (
					<ConnectorCard
						{...connectionOf(entry.slug)}
						entry={entry}
						key={entry.slug}
						onConnect={(trigger) => connectFromCard(entry.slug, trigger)}
						onOpenDetails={() => openDetails(entry.slug)}
						selected={detailSlug === entry.slug}
					/>
				))}
		</PageCardGrid>
	);

	if (searchResults) {
		return (
			<div className="grid min-w-0 gap-4">
				<RefreshFailedNotice loadError={loadError} />
				{catalogError ? (
					<p className="text-error-text text-xs" role="alert">
						{catalogError}
					</p>
				) : null}
				{matchingInstalled.length > 0 ? cards : null}
				{detailDialog}
			</div>
		);
	}

	return (
		<div className="grid select-text gap-4">
			{heading}
			<RefreshFailedNotice loadError={loadError} />
			<CatalogErrorNotice error={catalogError} onRetry={refreshCatalog} />

			<section className="grid min-w-0 gap-3">
				{matchingInstalled.length > 0 ? (
					cards
				) : (
					<CustomizationEmptyState
						itemLabel="connectors"
						marketplaceType="connector"
						qualifier={
							trimmedQuery
								? `for "${searchQuery.trim()}"`
								: category
									? `in ${category.label}`
									: undefined
						}
					/>
				)}
			</section>

			{detailDialog}
		</div>
	);
}

/** The connectors an account could connect, with suggested combinations. */
export function ConnectorCatalogView({
	model,
	searchQuery = "",
	searchResults = false,
	renderItem,
	catalogHeader,
	catalogPreview,
}: {
	model: ConnectorResults;
	/** The host page's search text, as typed. */
	searchQuery?: string;
	/** Return result cards and errors without local navigation or discovery. */
	searchResults?: boolean;
	/** The catalog's heading, rendered before its results. */
	catalogHeader?: ReactNode;
	/** A capped Browse overview with suggestions below the connector cards. */
	catalogPreview?: { limit: number; onViewAll: () => void };
	renderItem?: (props: {
		entry: ComposioCatalogToolkit;
		status: ComposioIntegrationStatus;
		selected: boolean;
		onOpenDetails: () => void;
		/** Attach to the card opener so disappearing actions can return focus to it. */
		primaryRef: Ref<HTMLButtonElement>;
		/** Connection controls bound to the shared connection workflow. */
		actions: ReactNode;
	}) => ReactNode;
}) {
	const primaryButtons = usePrimaryButtonRefs();
	const {
		busyToolkit,
		cancelConnect,
		detailSlug,
		connectFromCard,
		openDetails,
		connectionOf,
		detailDialog,
	} = useConnectorActions(model);
	const {
		status,
		statusBySlug,
		configured,
		loadError,
		catalog,
		catalogError,
		catalogLoading,
		matchingCatalog,
		category,
		trimmedQuery,
		refreshCatalog,
	} = model;

	// Search shows every match; Browse shows a capped preview or pages in more.
	const categoryId = category?.id ?? null;
	const [page, setPage] = useState({ categoryId, limit: CATALOG_PAGE_SIZE });
	if (page.categoryId !== categoryId) {
		setPage({ categoryId, limit: CATALOG_PAGE_SIZE });
	}
	const visibleCatalog = searchResults
		? matchingCatalog
		: matchingCatalog.slice(0, catalogPreview?.limit ?? page.limit);
	const hasMore =
		!searchResults &&
		!catalogPreview &&
		visibleCatalog.length < matchingCatalog.length;
	const loadMoreRef = useRef<HTMLDivElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Reobserve after appending so a sentinel still in view can load another page.
	useEffect(() => {
		const sentinel = loadMoreRef.current;
		if (!hasMore || !sentinel) return;
		let active = true;
		const observer = new IntersectionObserver(
			(entries) => {
				if (!active || !entries.some((entry) => entry.isIntersecting)) return;
				active = false;
				setPage((current) => ({
					...current,
					limit: current.limit + CATALOG_PAGE_SIZE,
				}));
			},
			{ root: findScrollViewport(sentinel), rootMargin: "200px" },
		);
		observer.observe(sentinel);
		return () => {
			active = false;
			observer.disconnect();
		};
	}, [hasMore, visibleCatalog.length, categoryId]);

	if (!status) {
		return (
			<ConnectorsPending
				heading={searchResults ? null : catalogHeader}
				loadError={loadError}
			/>
		);
	}
	if (!configured) {
		if (searchResults) return null;
		// The Marketplace hides its connector section in this case.
		return (
			<div className="grid gap-4">
				{catalogHeader}
				<p className="text-muted-foreground text-sm">
					Connectors aren&apos;t available.
				</p>
			</div>
		);
	}

	const catalogList =
		catalogLoading && !catalog ? (
			<output
				aria-label="Loading connector catalog"
				className="flex items-center justify-center py-10"
			>
				<Loader2 className="size-5 animate-spin text-muted-foreground" />
			</output>
		) : catalogError ? (
			<CatalogErrorNotice error={catalogError} onRetry={refreshCatalog} />
		) : (
			<>
				{/* The host page owns scrolling. */}
				<div className="min-w-0">
					<PageCardGrid>
						{visibleCatalog.map((entry) => {
							const connection = connectionOf(entry.slug);
							return (
								<div className="min-w-0" key={entry.slug}>
									{renderItem ? (
										renderItem({
											entry,
											status: connection.status,
											selected: detailSlug === entry.slug,
											onOpenDetails: () => openDetails(entry.slug),
											primaryRef: primaryButtons.ref(entry.slug),
											actions: (
												<ConnectorCardAction
													{...connection}
													onConnect={(trigger) =>
														connectFromCard(
															entry.slug,
															primaryButtons.get(entry.slug) ?? trigger,
														)
													}
												/>
											),
										})
									) : (
										<ConnectorCard
											{...connection}
											entry={entry}
											onConnect={(trigger) =>
												connectFromCard(entry.slug, trigger)
											}
											onOpenDetails={() => openDetails(entry.slug)}
											selected={detailSlug === entry.slug}
										/>
									)}
								</div>
							);
						})}
					</PageCardGrid>
					{!searchResults && visibleCatalog.length === 0 ? (
						<EmptyState>
							{trimmedQuery
								? `No connectors match "${searchQuery.trim()}".`
								: category
									? `No connectors in ${category.label}.`
									: "No connectors are available for your account yet."}
						</EmptyState>
					) : null}
				</div>
				{hasMore ? (
					<div ref={loadMoreRef} className="h-px" aria-hidden="true" />
				) : null}
			</>
		);

	if (searchResults) {
		return (
			<div className="grid min-w-0 gap-4">
				<RefreshFailedNotice loadError={loadError} />
				{catalogList}
				{detailDialog}
			</div>
		);
	}

	const recipes = COMPOSIO_RECIPES.filter((recipe) =>
		recipe.connectors.some(
			(connector) => statusBySlug.get(connector.slug)?.status !== "connected",
		),
	);
	const suggestions =
		!trimmedQuery && !category && recipes.length > 0 ? (
			<section aria-label="Suggested connectors" className="grid min-w-0 gap-3">
				<CustomizeSectionHeading
					title="Suggested"
					description="Connector combinations that work well together. Connect the ones you are missing to unlock the workflow."
					count={catalogPreview ? undefined : recipes.length}
					headingLevel={3}
				/>
				<PageCardGrid>
					{recipes
						.slice(0, catalogPreview?.limit ?? recipes.length)
						.map((recipe) => (
							<RecipeCard
								busyToolkit={busyToolkit}
								key={recipe.id}
								onCancel={(slug) => void cancelConnect(slug)}
								onConnect={connectFromCard}
								onOpenDetails={openDetails}
								recipe={recipe}
								statusBySlug={statusBySlug}
							/>
						))}
				</PageCardGrid>
			</section>
		) : null;

	return (
		<div className="flex select-text flex-col gap-4">
			{!renderItem ? (
				<p className="text-muted-foreground text-sm">
					<Badge className="mr-1">Beta</Badge>
					Connect your accounts to give Cline tools for your favorite apps.
					Tools will become available in new sessions.
				</p>
			) : null}

			{!catalogPreview ? suggestions : null}
			{catalogHeader}
			{catalogList}
			{catalogPreview ? suggestions : null}

			{detailDialog}
		</div>
	);
}
