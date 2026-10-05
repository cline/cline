"use client";

import { GitHubIcon } from "@cline/ui";
import {
	CalendarDays,
	Check,
	ExternalLink,
	Loader2,
	LogIn,
	Mail,
	Plus,
	RefreshCw,
	Search,
	Trash2,
} from "lucide-react";
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
import { useAccount } from "@/contexts/account-context";
import { useOAuthUserCode } from "@/hooks/use-oauth-user-code";
import { fetchComposioToolkitCatalog } from "@/lib/composio";
import {
	COMPOSIO_RECIPES,
	type ComposioRecipe,
	composioLogoUrl,
} from "@/lib/composio-recipes";
import type {
	ComposioCatalogToolkit,
	ComposioIntegrationStatus,
	ComposioIntegrationSummary,
	ComposioToolkitSlug,
} from "@/lib/composio-types";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import { OAUTH_LOGIN_TIMEOUT_MS } from "@/lib/provider-connection";
import { invalidateProviderCatalogCache } from "@/lib/provider-model-catalog";
import { useComposioConnections } from "@/lib/use-composio-connections";
import { cn } from "@/lib/utils";

/** Shared connector browser for Customize and Marketplace. */

const CREATE_ACCOUNT_URL = "https://app.cline.bot";

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

/** The connector's brand mark, filling `className` (size and radius) edge to
 * edge so it doubles as the tile wherever one is needed. */
export function ConnectorLogo({
	slug,
	name,
	logo,
	className,
}: {
	slug: string;
	name: string;
	logo?: string;
	className?: string;
}) {
	// Keyed to the URL so a later, different logo (status arriving after the
	// slug fallback 404ed) gets its own attempt.
	const [failedSrc, setFailedSrc] = useState<string | null>(null);
	// Composio serves every toolkit's logo by slug, so a missing catalog logo
	// still resolves to the real brand mark.
	const src = logo ?? composioLogoUrl(slug);
	if (failedSrc !== src) {
		return (
			// biome-ignore lint/performance/noImgElement: Composio logos live on arbitrary remote hosts Next's optimizer is not configured for.
			<img
				alt=""
				// The white backing keeps dark brand marks (GitHub's, for one)
				// visible on dark tiles.
				className={cn(
					"size-5 shrink-0 rounded-sm bg-white object-contain",
					className,
				)}
				onError={() => setFailedSrc(src)}
				src={src}
			/>
		);
	}
	// Themed fallbacks for the recommended toolkits when the logo host is
	// unreachable.
	const LocalIcon = FALLBACK_ICONS[slug];
	return (
		<span
			className={cn(
				"flex size-5 shrink-0 items-center justify-center rounded-sm bg-secondary text-foreground",
				className,
			)}
		>
			{LocalIcon ? (
				<LocalIcon className="size-[60%]" />
			) : (
				<span className="text-xs font-semibold uppercase leading-none text-muted-foreground">
					{name.slice(0, 1)}
				</span>
			)}
		</span>
	);
}

export function ConnectorActionButton({
	status,
	configured,
	busy,
	showUninstall = false,
	size = "sm",
	onConnect,
	onCancel,
	onDisconnect,
	onView,
}: {
	status: ComposioIntegrationStatus;
	configured: boolean;
	busy: boolean;
	size?: "sm" | "xs";
	/** Installed connectors show an Uninstall action where management is
	 * expected (Customize > Connectors cards and the detail dialog); catalog
	 * rows show a View button that opens the detail dialog instead. */
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
					size={size}
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
				size={size}
				type="button"
				variant="destructive"
			>
				{busy ? (
					<Loader2 className="size-4 animate-spin" />
				) : (
					<Trash2 className="size-4" />
				)}
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
				size={size}
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
			size={size}
			type="button"
			variant="default"
		>
			{busy ? <Loader2 className="size-4 animate-spin" /> : null}
			Install
		</Button>
	);
}

export function ComposioConnectorsView({
	variant = "catalog",
	onChanged,
	searchQuery,
	onCatalogCountChange,
	renderItem,
	appendOnScroll = false,
}: {
	variant?: "catalog" | "installed";
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
		refreshing,
		refresh,
		connect,
		cancelConnect,
		disconnect,
	} = useComposioConnections({ onChanged });

	const [catalog, setCatalog] = useState<ComposioCatalogToolkit[] | null>(null);
	const [catalogError, setCatalogError] = useState<string | null>(null);
	const [catalogLoading, setCatalogLoading] = useState(false);
	// Customize keeps two fields so each one visibly owns one list: the top
	// field filters Installed, the Browse field filters the catalog (`query`,
	// which the Marketplace drives from its host search instead).
	const [installedQuery, setInstalledQuery] = useState("");
	const [localQuery, setLocalQuery] = useState("");
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
		if (!configured) return;
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
	}, [configured, retry]);

	useEffect(() => {
		// listToolkits resolves only after every backend page has been fetched.
		onCatalogCountChange?.(catalog?.length ?? null);
	}, [catalog, onCatalogCountChange]);

	const installedEntries = useMemo<ComposioCatalogToolkit[]>(
		() =>
			(status?.integrations ?? [])
				.filter((integration) => integration.status !== "not_connected")
				.map((integration) => ({
					slug: integration.toolkit,
					name: integration.name,
					description: integration.description,
					logo: integration.logo,
					recommended: integration.recommended,
				})),
		[status],
	);
	// Customize's Browse section lists only what is not installed yet, like
	// the other Customize tabs; the Marketplace lists the whole catalog.
	const entries = useMemo<ComposioCatalogToolkit[]>(() => {
		if (variant === "catalog") return catalog ?? [];
		return (catalog ?? []).filter(
			(entry) =>
				(statusBySlug.get(entry.slug)?.status ?? "not_connected") ===
				"not_connected",
		);
	}, [variant, catalog, statusBySlug]);

	const trimmedQuery = query.trim().toLowerCase();
	const [page, setPage] = useState({
		query: trimmedQuery,
		limit: CATALOG_PREVIEW_COUNT,
	});
	if (page.query !== trimmedQuery) {
		setPage({ query: trimmedQuery, limit: CATALOG_PREVIEW_COUNT });
	}
	const trimmedInstalledQuery = installedQuery.trim().toLowerCase();
	const matchingInstalled = useMemo(() => {
		return trimmedInstalledQuery
			? installedEntries.filter((entry) =>
					connectorMatchesQuery(entry, trimmedInstalledQuery),
				)
			: installedEntries;
	}, [installedEntries, trimmedInstalledQuery]);
	const matchingCatalog = useMemo(() => {
		return trimmedQuery
			? entries.filter((entry) => connectorMatchesQuery(entry, trimmedQuery))
			: entries;
	}, [entries, trimmedQuery]);
	const visibleCatalog = matchingCatalog.slice(
		0,
		appendOnScroll
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
		: matchingCatalog.length - visibleCatalog.length;

	// The catalog entry carries categories and tool counts the status
	// payload lacks, so prefer it even for installed connectors.
	const detailEntry = detailSlug
		? (catalog?.find((entry) => entry.slug === detailSlug) ??
			installedEntries.find((entry) => entry.slug === detailSlug) ??
			null)
		: null;
	const detailStatus = detailSlug ? statusBySlug.get(detailSlug) : undefined;

	if (loadError && !status) {
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
		if (variant === "installed") {
			return (
				<ConnectorsUnavailable onRefresh={refresh} refreshing={refreshing} />
			);
		}
		// The Marketplace hides its connector section in this case.
		return (
			<p className="text-sm text-muted-foreground">
				Connectors aren&apos;t available.
			</p>
		);
	}

	const detailDialog = (
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
	);

	const catalogList =
		catalogLoading && !catalog ? (
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
						className={renderItem ? "grid gap-1" : "grid gap-2 md:grid-cols-2"}
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
						Showing the {CATALOG_PREVIEW_COUNT} most-used connectors — search to
						find {hiddenCount} more.
					</p>
				) : null}
			</>
		);

	if (variant === "installed") {
		// Mirrors the Skills / Plugins / MCP tabs: description + refresh, then
		// an Installed section with a count and its own search. Suggested
		// recipes follow; each one drops out once all its connectors are
		// connected, so the section empties itself over time. Browse lists the
		// rest of the catalog so nobody has to leave for the Marketplace.
		const recipes = COMPOSIO_RECIPES.filter((recipe) =>
			recipe.connectors.some(
				(connector) => statusBySlug.get(connector.slug)?.status !== "connected",
			),
		);
		return (
			<div className="grid gap-6 select-text">
				<div className="grid gap-4">
					<div className="flex items-center justify-between gap-3">
						<p className="text-sm text-muted-foreground">
							Connect your accounts to give Cline tools for your favorite apps.
							Tools become available in new sessions.
						</p>
						<Button
							aria-label="Refresh connectors"
							disabled={refreshing}
							onClick={() => void refresh()}
							size="sm"
							type="button"
							variant="outline"
						>
							<RefreshCw
								className={cn("size-4", refreshing && "animate-spin")}
							/>
						</Button>
					</div>
					{loadError ? (
						<p className="text-xs text-destructive" role="alert">
							Failed to refresh connectors: {loadError}
						</p>
					) : null}
				</div>

				<section className="grid min-w-0 gap-3">
					<div className="flex items-center justify-between gap-3">
						<h2 className="text-base font-semibold text-foreground">
							Installed
						</h2>
						<span className="text-sm text-muted-foreground">
							{installedEntries.length}
						</span>
					</div>
					{installedEntries.length > 0 ? (
						<div className="relative">
							<Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								aria-label="Search installed connectors"
								className="h-10 pl-8"
								onChange={(event) => setInstalledQuery(event.target.value)}
								placeholder="Search installed connectors"
								value={installedQuery}
							/>
						</div>
					) : null}
					{matchingInstalled.length > 0 ? (
						<div className="grid min-w-0 gap-3">
							{matchingInstalled.map((entry) => (
								<ConnectorCard
									busy={busyToolkit === entry.slug}
									entry={entry}
									error={
										actionError?.toolkit === entry.slug
											? actionError.message
											: undefined
									}
									key={entry.slug}
									onCancel={() => void cancelConnect(entry.slug)}
									onConnect={() => void connect(entry.slug)}
									onDisconnect={() => void disconnect(entry.slug)}
									onOpenDetails={() => setDetailSlug(entry.slug)}
									summary={statusBySlug.get(entry.slug)}
								/>
							))}
						</div>
					) : (
						<div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
							{trimmedInstalledQuery
								? `No installed connectors match "${installedQuery.trim()}".`
								: "No connectors installed. Install a connector below or ask Cline about it in a task."}
						</div>
					)}
				</section>

				{recipes.length > 0 ? (
					<section className="grid min-w-0 gap-3">
						<div className="flex items-center justify-between gap-3">
							<div className="grid gap-0.5">
								<h2 className="text-base font-semibold text-foreground">
									Suggested
								</h2>
								<p className="text-xs text-muted-foreground">
									Connector combinations that work well together. Install the
									ones you are missing to unlock the workflow.
								</p>
							</div>
							<span className="text-sm text-muted-foreground">
								{recipes.length}
							</span>
						</div>
						<div className="grid min-w-0 gap-3 md:grid-cols-2">
							{recipes.map((recipe) => (
								<RecipeCard
									actionError={actionError}
									busyToolkit={busyToolkit}
									key={recipe.id}
									onCancel={(slug) => void cancelConnect(slug)}
									onConnect={(slug) => void connect(slug)}
									recipe={recipe}
									statusBySlug={statusBySlug}
								/>
							))}
						</div>
					</section>
				) : null}

				<section className="grid min-w-0 gap-3">
					<div className="flex items-center justify-between gap-3">
						<h2 className="text-base font-semibold text-foreground">Browse</h2>
						{catalog ? (
							<span className="text-sm text-muted-foreground">
								{matchingCatalog.length}
							</span>
						) : null}
					</div>
					{catalog ? (
						<div className="relative">
							<Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								aria-label="Search all connectors"
								className="h-10 pl-8"
								onChange={(event) => setLocalQuery(event.target.value)}
								placeholder="Search all connectors"
								value={localQuery}
							/>
						</div>
					) : null}
					{catalogList}
				</section>

				{detailDialog}
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4 select-text">
			{!renderItem ? (
				<div className="flex flex-wrap items-center justify-between gap-3">
					<p className="text-sm text-muted-foreground">
						<Badge className="mr-1">Beta</Badge>Connect your accounts to give
						Cline tools for your favorite apps. Tools will become available in
						new sessions.
					</p>
					{searchQuery === undefined ? (
						<div className="relative">
							<Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
							<Input
								className="h-8 w-64 pl-8"
								onChange={(event) => setLocalQuery(event.target.value)}
								aria-label="Search connectors"
								placeholder="Search connectors"
								value={query}
							/>
						</div>
					) : null}
				</div>
			) : null}

			{catalogList}

			{detailDialog}
		</div>
	);
}

/** A taste of what connectors cover, shown while the account cannot use them. */
const PREVIEW_CONNECTORS: { slug: ComposioToolkitSlug; name: string }[] = [
	{ slug: "gmail", name: "Gmail" },
	{ slug: "slack", name: "Slack" },
	{ slug: "github", name: "GitHub" },
	{ slug: "googlecalendar", name: "Google Calendar" },
	{ slug: "notion", name: "Notion" },
	{ slug: "linear", name: "Linear" },
];

/** Customize > Connectors when the account cannot use connectors: signed out
 * (sign in right here, same device-code flow as the Account page) or signed
 * in without beta access (explain and offer a refresh). */
function ConnectorsUnavailable({
	onRefresh,
	refreshing,
}: {
	onRefresh: () => Promise<void>;
	refreshing: boolean;
}) {
	const { user, accountReady, refreshAccount } = useAccount();
	const [signingIn, setSigningIn] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const deviceUserCode = useOAuthUserCode(signingIn);

	const signIn = async () => {
		setSigningIn(true);
		setError(null);
		try {
			await desktopClient.invoke(
				"run_provider_oauth_login",
				{ provider: "cline" },
				// The browser round-trip routinely outlives the default command
				// deadline; the sidecar bounds the flow by device-code expiry.
				{ timeoutMs: OAUTH_LOGIN_TIMEOUT_MS },
			);
			invalidateProviderCatalogCache();
			await Promise.all([refreshAccount(), onRefresh()]);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSigningIn(false);
		}
	};

	const signedIn = user !== null;
	// A cached identity renders immediately; otherwise wait for the lookup
	// rather than telling a signed-in user to sign in.
	if (!signedIn && !accountReady) {
		return (
			<output
				aria-label="Loading account"
				className="flex items-center justify-center py-16"
			>
				<Loader2 className="size-6 animate-spin text-muted-foreground" />
			</output>
		);
	}
	return (
		<div className="rounded-lg border bg-card p-6 select-text">
			<div className="mx-auto flex max-w-xl flex-col items-center gap-5 py-6 text-center">
				<div className="flex items-center gap-2">
					{PREVIEW_CONNECTORS.map((connector) => (
						<ConnectorLogo
							className="size-9 rounded-lg border"
							key={connector.slug}
							name={connector.name}
							slug={connector.slug}
						/>
					))}
				</div>
				<div className="grid gap-2">
					<h2 className="text-lg font-semibold text-foreground">
						{signedIn
							? "Connectors aren't enabled for your account yet"
							: "Sign in to Cline to use connectors"}
					</h2>
					<p className="text-sm text-muted-foreground">
						{signedIn
							? "Connectors are rolling out in beta. Once your Cline account has access, Gmail, Slack, GitHub, and hundreds of other apps will show up here with one-click install."
							: "Connectors give Cline tools for Gmail, Slack, GitHub, and hundreds of other apps with a quick sign-in to each, no API keys. They require a Cline account."}
					</p>
				</div>
				{signedIn ? (
					<Button
						disabled={refreshing}
						onClick={() => void onRefresh()}
						size="sm"
						type="button"
						variant="outline"
					>
						<RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
						Check again
					</Button>
				) : (
					<div className="flex flex-wrap items-center justify-center gap-2">
						<Button
							disabled={signingIn}
							onClick={() => void signIn()}
							size="sm"
							type="button"
						>
							{signingIn ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<LogIn className="size-4" />
							)}
							{signingIn ? "Waiting for browser…" : "Sign in"}
						</Button>
						<Button
							onClick={() => void openExternalUrl(CREATE_ACCOUNT_URL)}
							size="sm"
							type="button"
							variant="outline"
						>
							Create account
							<ExternalLink className="size-4" />
						</Button>
					</div>
				)}
				{signingIn && deviceUserCode ? (
					<p className="text-sm text-muted-foreground">
						Confirm this code in your browser:{" "}
						<span className="font-mono font-medium text-foreground">
							{deviceUserCode}
						</span>
					</p>
				) : null}
				{error ? (
					<p className="text-xs text-destructive" role="alert">
						{error}
					</p>
				) : null}
			</div>
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
				<ConnectorLogo
					className="size-8 rounded-lg"
					logo={entry.logo}
					name={entry.name}
					slug={entry.slug}
				/>
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

/** Card for Customize > Connectors, shaped like the installed Skills /
 * Plugins / MCP cards. The whole card opens the detail dialog, except the
 * action control (same pattern as MarketplaceEntryCard). */
function ConnectorCard({
	entry,
	summary,
	busy,
	error,
	onConnect,
	onCancel,
	onDisconnect,
	onOpenDetails,
}: {
	entry: ComposioCatalogToolkit;
	summary?: ComposioIntegrationSummary;
	busy: boolean;
	error?: string;
	onConnect: () => void;
	onCancel: () => void;
	onDisconnect: () => void;
	onOpenDetails: () => void;
}) {
	const status = summary?.status ?? "not_connected";
	const toolCount =
		status === "connected" ? summary?.toolNames?.length : entry.toolsCount;
	return (
		// biome-ignore lint/a11y/useSemanticElements: The card contains a nested action button, so the wrapper cannot be a native button.
		<div
			aria-label={`Open ${entry.name} details`}
			className="relative grid min-w-0 cursor-pointer gap-2 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-surface-hover-lighter focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
			onClick={(event) => {
				if (
					event.target instanceof HTMLElement &&
					event.target.closest("[data-connector-action]")
				) {
					return;
				}
				onOpenDetails();
			}}
			onKeyDown={(event) => {
				if (event.target !== event.currentTarget) return;
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onOpenDetails();
				}
			}}
			role="button"
			tabIndex={0}
		>
			<div className="absolute top-4 right-4" data-connector-action>
				<ConnectorActionButton
					busy={busy}
					configured
					onCancel={onCancel}
					onConnect={onConnect}
					onDisconnect={onDisconnect}
					showUninstall
					size="xs"
					status={status}
				/>
			</div>
			<div className="grid min-w-0 gap-2 pr-28">
				<span className="flex min-w-0 items-center gap-2">
					<ConnectorLogo
						className="size-4"
						logo={entry.logo}
						name={entry.name}
						slug={entry.slug}
					/>
					<span className="min-w-0 truncate text-sm font-semibold text-foreground">
						{entry.name}
					</span>
					{status === "pending" ? (
						<Badge variant="outline" className="shrink-0 text-muted-foreground">
							Authorizing…
						</Badge>
					) : null}
					{toolCount ? (
						<Badge variant="outline" className="shrink-0 text-muted-foreground">
							{toolCount} {toolCount === 1 ? "tool" : "tools"}
						</Badge>
					) : null}
				</span>
				{entry.description ? (
					<span className="line-clamp-2 text-xs leading-5 text-muted-foreground">
						{entry.description}
					</span>
				) : null}
			</div>
			{error ? (
				<p className="text-xs text-destructive" role="alert">
					{error}
				</p>
			) : null}
		</div>
	);
}

/** A suggested connector combination with per-connector install chips.
 * Connected members show a check; the rest install with one click. */
function RecipeCard({
	recipe,
	statusBySlug,
	busyToolkit,
	actionError,
	onConnect,
	onCancel,
}: {
	recipe: ComposioRecipe;
	statusBySlug: Map<string, ComposioIntegrationSummary>;
	busyToolkit: ComposioToolkitSlug | null;
	actionError: { toolkit: ComposioToolkitSlug; message: string } | null;
	onConnect: (slug: ComposioToolkitSlug) => void;
	onCancel: (slug: ComposioToolkitSlug) => void;
}) {
	const error = recipe.connectors.some(
		(connector) => connector.slug === actionError?.toolkit,
	)
		? actionError?.message
		: undefined;
	return (
		<div className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4">
			<div className="grid gap-1">
				<h3 className="text-sm font-semibold text-foreground">
					{recipe.title}
				</h3>
				<p className="text-xs leading-5 text-muted-foreground">
					{recipe.description}
				</p>
			</div>
			<p className="rounded-md border bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">
				&ldquo;{recipe.prompt}&rdquo;
			</p>
			<div className="mt-auto flex flex-wrap gap-2">
				{recipe.connectors.map((connector) => {
					const summary = statusBySlug.get(connector.slug);
					const status = summary?.status ?? "not_connected";
					const busy = busyToolkit === connector.slug;
					const logo = (
						<ConnectorLogo
							className="size-3.5"
							logo={summary?.logo}
							name={connector.name}
							slug={connector.slug}
						/>
					);
					if (status === "connected") {
						return (
							<span
								className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-background px-2 text-xs text-foreground"
								key={connector.slug}
							>
								{logo}
								{connector.name}
								<Check className="size-3.5 text-primary" />
							</span>
						);
					}
					return (
						<Button
							aria-label={
								status === "pending"
									? `Cancel ${connector.name}`
									: `Install ${connector.name}`
							}
							disabled={busy}
							key={connector.slug}
							onClick={() =>
								status === "pending"
									? onCancel(connector.slug)
									: onConnect(connector.slug)
							}
							size="xs"
							type="button"
							variant="outline"
						>
							{logo}
							{connector.name}
							{busy || status === "pending" ? (
								<Loader2 className="size-3.5 animate-spin text-muted-foreground" />
							) : (
								<Plus className="size-3.5 text-muted-foreground" />
							)}
						</Button>
					);
				})}
			</div>
			{error ? (
				<p className="text-xs text-destructive" role="alert">
					{error}
				</p>
			) : null}
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
	// A connected connector reports what new sessions actually get, even zero;
	// the catalog total only describes connectors that aren't installed.
	const isConnected = status === "connected";
	return (
		<Dialog onOpenChange={onOpenChange} open={entry !== null}>
			{/* Fixed dimensions so every connector opens the same-sized window;
			    the body scrolls when content overflows. */}
			<DialogContent className="flex h-[480px] flex-col select-text sm:max-w-lg">
				{entry ? (
					<>
						<DialogHeader>
							<div className="flex items-center gap-3">
								<ConnectorLogo
									className="size-10 rounded-xl"
									logo={entry.logo}
									name={entry.name}
									slug={entry.slug}
								/>
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
								{isConnected || typeof entry.toolsCount === "number" ? (
									<>
										<dt className="text-muted-foreground">Tools</dt>
										<dd className="text-foreground">
											{isConnected ? (
												<>
													{toolNames.length}{" "}
													<span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
														available in new sessions
													</span>
												</>
											) : (
												entry.toolsCount
											)}
										</dd>
										{isConnected && toolNames.length > 0 ? (
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
