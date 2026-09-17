"use client";

import { GitHubIcon } from "@cline/ui";
import { CalendarDays, Loader2, Mail, Search, Store } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { fetchComposioToolkitCatalog } from "@/lib/composio";
import type {
	ComposioCatalogToolkit,
	ComposioIntegrationStatus,
	ComposioIntegrationSummary,
	ComposioToolkitSlug,
} from "@/lib/composio-types";
import { useComposioConnections } from "@/lib/use-composio-connections";

/** Shared connector browser for Customize and Marketplace. */

/** How many catalog entries to show before asking the user to search. */
const CATALOG_PREVIEW_COUNT = 24;
const CATALOG_SEARCH_RESULT_LIMIT = 50;

/** Search connector names, descriptions, slugs, and categories. */
export function connectorMatchesQuery(
	entry: ComposioCatalogToolkit,
	trimmedQuery: string,
): boolean {
	return (
		entry.slug.includes(trimmedQuery) ||
		entry.name.toLowerCase().includes(trimmedQuery) ||
		entry.description?.toLowerCase().includes(trimmedQuery) ||
		entry.categories?.some((category) =>
			category.toLowerCase().includes(trimmedQuery),
		) ||
		false
	);
}

const FALLBACK_ICONS: Record<
	string,
	(props: { className?: string }) => React.ReactNode
> = {
	gmail: (props) => <Mail aria-hidden="true" {...props} />,
	googlecalendar: (props) => <CalendarDays aria-hidden="true" {...props} />,
	github: (props) => <GitHubIcon {...props} />,
};

export function ConnectorLogo({
	slug,
	name,
	logo,
	className = "size-5",
}: {
	slug: string;
	name: string;
	logo?: string;
	className?: string;
}) {
	const [failed, setFailed] = useState(false);
	if (logo && !failed) {
		return (
			// biome-ignore lint/performance/noImgElement: Composio logos live on arbitrary remote hosts Next's optimizer is not configured for.
			<img
				alt=""
				// The white backing keeps dark brand marks (GitHub's, for one)
				// visible on dark tiles.
				className={`${className} rounded-sm bg-white object-contain p-px`}
				onError={() => setFailed(true)}
				src={logo}
			/>
		);
	}
	// Themed fallbacks for the recommended toolkits when the catalog (and its
	// official logos) has not loaded yet.
	const LocalIcon = FALLBACK_ICONS[slug];
	if (LocalIcon) {
		return <LocalIcon className={className} />;
	}
	return (
		<span className="text-xs font-semibold uppercase text-muted-foreground">
			{name.slice(0, 1)}
		</span>
	);
}

export function ConnectorActionButton({
	status,
	configured,
	busy,
	showUninstall = false,
	onConnect,
	onCancel,
	onDisconnect,
	onView,
}: {
	status: ComposioIntegrationStatus;
	configured: boolean;
	busy: boolean;
	/** Installed connectors show an Uninstall action where management is
	 * expected (the detail dialog in Customize > Connectors); list rows show a
	 * View button that opens the detail dialog instead. */
	showUninstall?: boolean;
	onConnect: () => void;
	onCancel: () => void;
	onDisconnect: () => void;
	/** Opens the detail dialog; used by the View state in list rows. */
	onView?: () => void;
}) {
	if (status === "connected") {
		if (!showUninstall) {
			return (
				<Button
					onClick={(event) => {
						event.stopPropagation();
						onView?.();
					}}
					size="sm"
					type="button"
					variant="default"
				>
					View
				</Button>
			);
		}
		return (
			<Button
				disabled={busy}
				onClick={(event) => {
					event.stopPropagation();
					onDisconnect();
				}}
				size="sm"
				type="button"
				variant="destructive"
			>
				{busy ? <Loader2 className="size-4 animate-spin" /> : null}
				Uninstall
			</Button>
		);
	}
	if (status === "pending") {
		return (
			<Button
				onClick={(event) => {
					event.stopPropagation();
					onCancel();
				}}
				size="sm"
				type="button"
				variant="ghost"
			>
				<Loader2 className="size-4 animate-spin" />
				Cancel
			</Button>
		);
	}
	return (
		<Button
			disabled={!configured || busy}
			onClick={(event) => {
				event.stopPropagation();
				onConnect();
			}}
			size="sm"
			type="button"
			variant="outline"
		>
			{busy ? <Loader2 className="size-4 animate-spin" /> : null}
			Install
		</Button>
	);
}

export function ComposioConnectorsView({
	variant = "catalog",
	onOpenMarketplace,
	onChanged,
	searchQuery,
	onCatalogCountChange,
	renderItem,
	appendOnScroll = false,
}: {
	variant?: "catalog" | "installed";
	onOpenMarketplace?: () => void;
	onChanged?: () => void;
	appendOnScroll?: boolean;
	/** Use the host page search instead of rendering a separate search field. */
	searchQuery?: string;
	onCatalogCountChange?: (count: number | null) => void;
	renderItem?: (props: {
		entry: ComposioCatalogToolkit;
		status: ComposioIntegrationStatus;
		selected: boolean;
		onOpenDetails: () => void;
	}) => ReactNode;
}) {
	const {
		status,
		statusBySlug,
		configured,
		loadError,
		actionError,
		busyToolkit,
		connect,
		cancelConnect,
		disconnect,
	} = useComposioConnections({ onChanged });

	const [catalog, setCatalog] = useState<ComposioCatalogToolkit[] | null>(null);
	const [catalogError, setCatalogError] = useState<string | null>(null);
	const [catalogLoading, setCatalogLoading] = useState(false);
	const [localQuery, setQuery] = useState("");
	const query = searchQuery ?? localQuery;
	const [retry, setRetry] = useState(0);
	const [detailSlug, setDetailSlug] = useState<ComposioToolkitSlug | null>(
		null,
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Retry explicitly reloads the catalog.
	useEffect(() => {
		let cancelled = false;
		setCatalog(null);
		setCatalogError(null);
		if (!configured || variant === "installed") return;
		setCatalogLoading(true);
		void fetchComposioToolkitCatalog()
			.then((response) => {
				if (!cancelled) setCatalog(response.toolkits);
			})
			.catch((error) => {
				if (!cancelled)
					setCatalogError(
						error instanceof Error ? error.message : String(error),
					);
			})
			.finally(() => {
				if (!cancelled) setCatalogLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [configured, retry, variant]);

	useEffect(() => {
		// listToolkits resolves only after every backend page has been fetched.
		onCatalogCountChange?.(catalog?.length ?? null);
	}, [catalog, onCatalogCountChange]);

	const entries = useMemo<ComposioCatalogToolkit[]>(() => {
		if (variant === "catalog") return catalog ?? [];
		return (status?.integrations ?? [])
			.filter((integration) => integration.status !== "not_connected")
			.map((integration) => ({
				slug: integration.toolkit,
				name: integration.name,
				description: integration.description,
				logo: integration.logo,
				recommended: integration.recommended,
			}));
	}, [variant, catalog, status]);

	const trimmedQuery = query.trim().toLowerCase();
	const [page, setPage] = useState({
		query: trimmedQuery,
		limit: CATALOG_PREVIEW_COUNT,
	});
	if (page.query !== trimmedQuery) {
		setPage({ query: trimmedQuery, limit: CATALOG_PREVIEW_COUNT });
	}
	const matchingCatalog = useMemo(() => {
		return trimmedQuery
			? entries.filter((entry) => connectorMatchesQuery(entry, trimmedQuery))
			: entries;
	}, [entries, trimmedQuery]);
	const visibleCatalog = matchingCatalog.slice(
		0,
		variant === "installed"
			? matchingCatalog.length
			: appendOnScroll
				? page.limit
				: trimmedQuery
					? CATALOG_SEARCH_RESULT_LIMIT
					: CATALOG_PREVIEW_COUNT,
	);
	const hasMore =
		appendOnScroll && visibleCatalog.length < matchingCatalog.length;
	const loadMoreRef = useRef<HTMLDivElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Reobserve after appending or searching so a sentinel still in view can load another page.
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
					limit: current.limit + CATALOG_PREVIEW_COUNT,
				}));
			},
			{
				root: sentinel.closest("[data-radix-scroll-area-viewport]"),
				rootMargin: "200px",
			},
		);
		observer.observe(sentinel);
		return () => {
			active = false;
			observer.disconnect();
		};
	}, [hasMore, visibleCatalog.length, trimmedQuery]);

	const hiddenCount = trimmedQuery
		? 0
		: variant === "installed"
			? 0
			: Math.max(0, (catalog?.length ?? 0) - CATALOG_PREVIEW_COUNT);

	const detailEntry = detailSlug
		? (entries.find((entry) => entry.slug === detailSlug) ?? null)
		: null;
	const detailStatus = detailSlug ? statusBySlug.get(detailSlug) : undefined;

	if (loadError) {
		return (
			<p className="select-text text-sm text-destructive" role="alert">
				Failed to load connectors: {loadError}
			</p>
		);
	}

	if (!status) {
		return (
			<output
				aria-label="Loading connectors"
				className="flex items-center justify-center py-16"
			>
				<Loader2 className="size-6 animate-spin text-muted-foreground" />
			</output>
		);
	}

	if (!configured) {
		// The parent hides this tab when the account has no beta access.
		return (
			<p className="text-sm text-muted-foreground">
				Connectors aren&apos;t available.
			</p>
		);
	}

	const marketplaceButton = onOpenMarketplace ? (
		<Button
			onClick={onOpenMarketplace}
			size="sm"
			type="button"
			variant="outline"
		>
			<Store className="size-4" />
			Browse all connectors in the Marketplace
		</Button>
	) : null;
	if (variant === "installed" && entries.length === 0) {
		return (
			<div className="flex min-h-64 items-center justify-center">
				{marketplaceButton}
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4 select-text">
			{!renderItem ? (
				<div className="flex flex-wrap items-center justify-between gap-3">
					<p className="text-sm text-muted-foreground">
						Connect your accounts to give Cline tools for your favorite apps.
						Tools will become available in new sessions.
					</p>
					{searchQuery === undefined ? (
						<div className="relative">
							<Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
							<Input
								className="h-8 w-64 pl-8"
								onChange={(event) => setQuery(event.target.value)}
								aria-label="Search connectors"
								placeholder="Search connectors"
								value={query}
							/>
						</div>
					) : null}
				</div>
			) : null}

			{variant === "catalog" && catalogLoading && !catalog ? (
				<output
					aria-label="Loading connector catalog"
					className="flex items-center justify-center py-10"
				>
					<Loader2 className="size-5 animate-spin text-muted-foreground" />
				</output>
			) : variant === "catalog" && catalogError ? (
				<div className="flex flex-wrap items-center gap-3">
					<p className="text-xs text-destructive" role="alert">
						{catalogError}
					</p>
					<Button
						onClick={() => setRetry((value) => value + 1)}
						size="sm"
						type="button"
						variant="outline"
					>
						Retry
					</Button>
				</div>
			) : (
				<>
					{/* The host page owns scrolling. */}
					<div className="min-w-0">
						<div
							className={
								renderItem
									? "grid gap-1"
									: "grid grid-cols-[repeat(auto-fit,minmax(min(100%,24rem),1fr))] gap-2"
							}
						>
							{visibleCatalog.map((entry) => (
								<div className="min-w-0" key={entry.slug}>
									{renderItem ? (
										renderItem({
											entry,
											status:
												statusBySlug.get(entry.slug)?.status ?? "not_connected",
											selected: detailSlug === entry.slug,
											onOpenDetails: () => setDetailSlug(entry.slug),
										})
									) : (
										<ConnectorRow
											busy={busyToolkit === entry.slug}
											entry={entry}
											onCancel={() => void cancelConnect(entry.slug)}
											onConnect={() => void connect(entry.slug)}
											onDisconnect={() => void disconnect(entry.slug)}
											onOpenDetails={() => setDetailSlug(entry.slug)}
											status={
												statusBySlug.get(entry.slug)?.status ?? "not_connected"
											}
										/>
									)}
									{actionError?.toolkit === entry.slug ? (
										// Scoped to this connector's own card; no shared
										// surface retains another connector's failure.
										<p
											className="mt-1 px-1 text-xs text-destructive"
											role="alert"
										>
											{actionError.message}
										</p>
									) : null}
								</div>
							))}
						</div>
						{visibleCatalog.length === 0 ? (
							<p className="py-4 text-sm text-muted-foreground">
								{trimmedQuery
									? `No connectors match "${query.trim()}".`
									: "No connectors are available for your account yet."}
							</p>
						) : null}
					</div>
					{hasMore ? (
						<div ref={loadMoreRef} className="h-px" aria-hidden="true" />
					) : null}
					{!appendOnScroll && hiddenCount > 0 ? (
						<p className="text-xs text-muted-foreground">
							Showing the {CATALOG_PREVIEW_COUNT} most-used connectors — search
							to find {hiddenCount} more.
						</p>
					) : null}
				</>
			)}

			{variant === "installed" && marketplaceButton ? (
				<div>{marketplaceButton}</div>
			) : null}

			<ConnectorDetailDialog
				actionError={
					detailSlug !== null && actionError?.toolkit === detailSlug
						? actionError.message
						: undefined
				}
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
				summary={detailStatus}
			/>
		</div>
	);
}

function ConnectorRow({
	entry,
	status,
	busy,
	onConnect,
	onCancel,
	onDisconnect,
	onOpenDetails,
}: {
	entry: ComposioCatalogToolkit;
	status: ComposioIntegrationStatus;
	busy: boolean;
	onConnect: () => void;
	onCancel: () => void;
	onDisconnect: () => void;
	onOpenDetails: () => void;
}) {
	return (
		<div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/60 px-3 py-2.5 transition-colors hover:border-border hover:bg-background">
			{/* A real button (nested interactives are invalid HTML, so the
			    connect/disconnect control stays outside it). */}
			<button
				className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
				onClick={onOpenDetails}
				type="button"
			>
				<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
					<ConnectorLogo
						logo={entry.logo}
						name={entry.name}
						slug={entry.slug}
					/>
				</span>
				<span className="min-w-0">
					<span className="block truncate text-sm font-medium text-foreground">
						{entry.name}
					</span>
					{entry.description ? (
						<span className="block truncate text-xs text-muted-foreground">
							{entry.description}
						</span>
					) : null}
				</span>
			</button>
			<ConnectorActionButton
				busy={busy}
				configured
				onCancel={onCancel}
				onConnect={onConnect}
				onDisconnect={onDisconnect}
				onView={onOpenDetails}
				status={status}
			/>
		</div>
	);
}

function ConnectorDetailDialog({
	entry,
	summary,
	actionError,
	busy,
	onConnect,
	onCancel,
	onDisconnect,
	onOpenChange,
}: {
	entry: ComposioCatalogToolkit | null;
	summary?: ComposioIntegrationSummary;
	/** Already scoped by the caller to THIS dialog's connector. */
	actionError?: string;
	busy: boolean;
	onConnect: () => void;
	onCancel: () => void;
	onDisconnect: () => void;
	onOpenChange: (open: boolean) => void;
}) {
	const status = summary?.status ?? "not_connected";
	const toolNames = summary?.toolNames ?? [];
	return (
		<Dialog onOpenChange={onOpenChange} open={entry !== null}>
			{/* Fixed dimensions so every connector opens the same-sized window;
			    the body scrolls when content overflows. */}
			<DialogContent className="flex h-[480px] flex-col select-text sm:max-w-lg">
				{entry ? (
					<>
						<DialogHeader>
							<div className="flex items-center gap-3">
								<span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground">
									<ConnectorLogo
										className="size-6"
										logo={entry.logo}
										name={entry.name}
										slug={entry.slug}
									/>
								</span>
								<div>
									<DialogTitle>{entry.name}</DialogTitle>
								</div>
							</div>
						</DialogHeader>

						<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
							{entry.description ? (
								<DialogDescription className="text-left">
									{entry.description}
								</DialogDescription>
							) : null}

							<dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
								{entry.categories && entry.categories.length > 0 ? (
									<>
										<dt className="text-muted-foreground">Category</dt>
										<dd className="flex flex-wrap gap-1">
											{entry.categories.map((category) => (
												<Badge
													className="font-normal"
													key={category}
													variant="outline"
												>
													{category}
												</Badge>
											))}
										</dd>
									</>
								) : null}
								{summary?.connectedAt ? (
									<>
										<dt className="text-muted-foreground">Connected</dt>
										<dd className="text-foreground">
											{new Date(summary.connectedAt).toLocaleString()}
										</dd>
									</>
								) : null}
								<dt className="text-muted-foreground">Slug</dt>
								<dd className="font-mono text-xs leading-5 text-foreground">
									{entry.slug}
								</dd>
								{typeof entry.toolsCount === "number" ||
								(status === "connected" && toolNames.length > 0) ? (
									<>
										<dt className="text-muted-foreground">Tools</dt>
										<dd className="text-foreground">
											{status === "connected" && toolNames.length > 0 ? (
												<>
													{toolNames.length}/
													{entry.toolsCount ?? toolNames.length}{" "}
													<span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
														available in new sessions
													</span>
												</>
											) : (
												entry.toolsCount
											)}
										</dd>
										{status === "connected" && toolNames.length > 0 ? (
											<dd className="col-span-2 mb-3 mt-1">
												<ul className="flex flex-wrap gap-1.5">
													{toolNames.map((name) => (
														<li key={name}>
															<Badge className="font-normal" variant="outline">
																{name}
															</Badge>
														</li>
													))}
												</ul>
											</dd>
										) : null}
									</>
								) : null}
							</dl>

							{status === "pending" ? (
								<p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
									<Loader2 className="size-4 animate-spin" />
									Finish authorizing {entry.name} in your browser…
								</p>
							) : null}

							{(actionError ?? summary?.error) ? (
								<p className="text-xs text-destructive" role="alert">
									{actionError ?? summary?.error}
								</p>
							) : null}
						</div>

						<DialogFooter>
							<ConnectorActionButton
								busy={busy}
								configured
								onCancel={onCancel}
								onConnect={onConnect}
								onDisconnect={onDisconnect}
								showUninstall
								status={status}
							/>
						</DialogFooter>
					</>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
