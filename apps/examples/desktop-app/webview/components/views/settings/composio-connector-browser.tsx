"use client";

import { GitHubIcon } from "@cline/ui";
import { CalendarDays, Loader2, Mail, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/**
 * Browsable Composio connector catalog: search, a fixed-height scrollable
 * result list (top connectors by usage until the user searches), and a detail
 * dialog per connector with the connect/disconnect actions.
 *
 * Rendered on the Marketplace page's Connectors tab; API key management lives
 * in Installed > Connectors.
 */

/** How many catalog entries to show before asking the user to search. */
const CATALOG_PREVIEW_COUNT = 24;
const CATALOG_SEARCH_RESULT_LIMIT = 50;

/** Shared with the Marketplace filter chips so connector counts follow the
 * same search semantics as the list itself. */
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
	variant = "ghost",
	showUninstall = false,
	onConnect,
	onCancel,
	onDisconnect,
	onView,
}: {
	status: ComposioIntegrationStatus;
	configured: boolean;
	busy: boolean;
	/** Visual weight of the Install button; state buttons stay subtle. */
	variant?: "ghost" | "default";
	/** Installed connectors show an Uninstall action where management is
	 * expected (the detail dialog, Installed > Connectors); list rows show a
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
					variant={variant}
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
			variant={variant}
		>
			{busy ? <Loader2 className="size-4 animate-spin" /> : null}
			Install
		</Button>
	);
}

export function ComposioConnectorBrowser({
	onChanged,
	query: externalQuery,
	hideSearch = false,
	onCatalogLoaded,
}: {
	onChanged?: () => void;
	/** Externally controlled search text (e.g. the Marketplace search bar);
	 * when provided the built-in search input is usually hidden. */
	query?: string;
	hideSearch?: boolean;
	/** Reports the catalog size, e.g. for a count badge on a filter chip. */
	onCatalogLoaded?: (count: number) => void;
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
	const [ownQuery, setOwnQuery] = useState("");
	const [detailSlug, setDetailSlug] = useState<ComposioToolkitSlug | null>(
		null,
	);
	const query = externalQuery ?? ownQuery;

	const onCatalogLoadedRef = useRef(onCatalogLoaded);
	useEffect(() => {
		onCatalogLoadedRef.current = onCatalogLoaded;
	}, [onCatalogLoaded]);

	const loadCatalog = useCallback(async () => {
		setCatalogLoading(true);
		setCatalogError(null);
		try {
			const response = await fetchComposioToolkitCatalog();
			setCatalog(response.toolkits);
			onCatalogLoadedRef.current?.(response.toolkits.length);
		} catch (error) {
			setCatalogError(error instanceof Error ? error.message : String(error));
		} finally {
			setCatalogLoading(false);
		}
	}, []);

	// The catalog needs an API key; (re)load it once configured.
	useEffect(() => {
		if (configured) {
			void loadCatalog();
		} else {
			setCatalog(null);
		}
	}, [configured, loadCatalog]);

	const trimmedQuery = query.trim().toLowerCase();
	const visibleCatalog = useMemo(() => {
		const entries = catalog ?? [];
		if (!trimmedQuery) {
			return entries.slice(0, CATALOG_PREVIEW_COUNT);
		}
		return entries
			.filter((entry) => connectorMatchesQuery(entry, trimmedQuery))
			.slice(0, CATALOG_SEARCH_RESULT_LIMIT);
	}, [catalog, trimmedQuery]);

	const hiddenCount = trimmedQuery
		? 0
		: Math.max(0, (catalog?.length ?? 0) - CATALOG_PREVIEW_COUNT);

	const detailEntry = detailSlug
		? (catalog?.find((entry) => entry.slug === detailSlug) ?? null)
		: null;
	const detailStatus = detailSlug ? statusBySlug.get(detailSlug) : undefined;

	if (loadError) {
		return (
			<p className="text-sm text-destructive" role="alert">
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
		// Normally unreachable — the Connectors filter chip is hidden in builds
		// without a managed key — but reachable transiently while status loads.
		return (
			<p className="text-sm text-muted-foreground">
				Connectors aren&apos;t available in this build.
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className="text-sm text-muted-foreground">
					Connect your accounts to give Cline tools for your favorite apps.
					Connected tools become available in new sessions.
				</p>
				{hideSearch ? null : (
					<div className="relative">
						<Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input
							className="h-8 w-64 pl-8"
							onChange={(event) => setOwnQuery(event.target.value)}
							placeholder="Search connectors"
							value={ownQuery}
						/>
					</div>
				)}
			</div>

			{actionError ? (
				<p className="text-xs text-destructive" role="alert">
					{actionError}
				</p>
			) : null}

			{catalogLoading && !catalog ? (
				<output
					aria-label="Loading connector catalog"
					className="flex items-center justify-center py-10"
				>
					<Loader2 className="size-5 animate-spin text-muted-foreground" />
				</output>
			) : catalogError ? (
				<div className="flex flex-wrap items-center gap-3">
					<p className="text-xs text-destructive" role="alert">
						{catalogError}
					</p>
					<Button
						onClick={() => void loadCatalog()}
						size="sm"
						type="button"
						variant="outline"
					>
						Retry
					</Button>
				</div>
			) : (
				<>
					{/* Fill the remaining viewport below the marketplace header,
					    search, and filter chips; scroll inside the box. */}
					<div className="max-h-[calc(100dvh-370px)] min-h-80 overflow-y-auto pr-1">
						<div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
							{visibleCatalog.map((entry) => (
								<ConnectorRow
									busy={busyToolkit === entry.slug}
									entry={entry}
									key={entry.slug}
									onCancel={() => void cancelConnect(entry.slug)}
									onConnect={() => void connect(entry.slug)}
									onDisconnect={() => void disconnect(entry.slug)}
									onOpenDetails={() => setDetailSlug(entry.slug)}
									status={
										statusBySlug.get(entry.slug)?.status ?? "not_connected"
									}
								/>
							))}
						</div>
						{visibleCatalog.length === 0 ? (
							<p className="py-4 text-sm text-muted-foreground">
								No connectors match "{query.trim()}".
							</p>
						) : null}
					</div>
					{hiddenCount > 0 ? (
						<p className="text-xs text-muted-foreground">
							Showing the {CATALOG_PREVIEW_COUNT} most-used connectors — search
							to find {hiddenCount} more.
						</p>
					) : null}
				</>
			)}

			<ConnectorDetailDialog
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
	busy,
	onConnect,
	onCancel,
	onDisconnect,
	onOpenChange,
}: {
	entry: ComposioCatalogToolkit | null;
	summary?: ComposioIntegrationSummary;
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
			<DialogContent className="flex h-[480px] flex-col sm:max-w-lg">
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
									{entry.categories && entry.categories.length > 0 ? (
										<div className="mt-1 flex flex-wrap gap-1">
											{entry.categories.map((category) => (
												<Badge
													className="font-normal"
													key={category}
													variant="outline"
												>
													{category}
												</Badge>
											))}
										</div>
									) : null}
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
								{typeof entry.toolsCount === "number" ? (
									<>
										<dt className="text-muted-foreground">Tools</dt>
										<dd className="text-foreground">{entry.toolsCount}</dd>
									</>
								) : null}
								<dt className="text-muted-foreground">Slug</dt>
								<dd className="font-mono text-xs leading-5 text-foreground">
									{entry.slug}
								</dd>
								{summary?.connectedAt ? (
									<>
										<dt className="text-muted-foreground">Connected</dt>
										<dd className="text-foreground">
											{new Date(summary.connectedAt).toLocaleString()}
										</dd>
									</>
								) : null}
							</dl>

							{status === "pending" ? (
								<p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
									<Loader2 className="size-4 animate-spin" />
									Finish authorizing {entry.name} in your browser…
								</p>
							) : null}

							{summary?.error ? (
								<p className="text-xs text-destructive" role="alert">
									{summary.error}
								</p>
							) : null}

							{status === "connected" && toolNames.length > 0 ? (
								<div>
									<p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
										{toolNames.length} tool{toolNames.length === 1 ? "" : "s"}{" "}
										available in new sessions
									</p>
									<ul className="flex flex-wrap gap-1.5">
										{toolNames.map((name) => (
											<li key={name}>
												<Badge className="font-normal" variant="outline">
													{name}
												</Badge>
											</li>
										))}
									</ul>
								</div>
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
								variant="default"
							/>
						</DialogFooter>
					</>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
