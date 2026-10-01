import {
	Blocks,
	ChevronRight,
	ExternalLink,
	Puzzle,
	Search,
	Server,
	Star,
	Store,
	Trash2,
	X,
	Zap,
} from "lucide-react";
import {
	type CSSProperties,
	type MouseEvent,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import {
	fetchMarketplaceCatalog,
	type MarketplaceCatalog,
	type MarketplaceEntry,
	type MarketplacePrimitiveType,
	type MarketplaceTag,
} from "@/lib/marketplace";
import { cn } from "@/lib/utils";
import { CommandBadge, PageFrame, PageHeader } from "./page-layout";

type EntryActionState =
	| { status: "idle" }
	| { status: "installing" }
	| { status: "uninstalling" }
	| {
			status: "installed";
			message: string;
	  }
	| {
			status: "uninstalled";
			message: string;
	  }
	| { status: "failed"; message: string };

type MarketplaceInstallResult = {
	status: "installed" | "uninstalled";
	message: string;
	output?: string;
};

type MarketplaceInstallStatusResult = {
	installedKeys: string[];
};

type InstalledStatusState = "loading" | "ready";

const INSTALL_TIMEOUT_MS = 300_000;
const CODE_FONT_STYLE: CSSProperties = {
	fontFamily:
		'"Geist Mono Variable", ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
};

type MarketplacePageDetails = {
	title: string;
	description: string;
	emptyInstalled: string;
	emptyCatalog: string;
	icon: typeof Server;
};

const primitivePageDetails = {
	mcp: {
		title: "MCP Servers",
		description:
			"Install Model Context Protocol servers into this CLI environment.",
		emptyInstalled:
			"No MCP servers installed. Browse the marketplace or add a server manually.",
		emptyCatalog: "No MCP servers match the current filters.",
		icon: Server,
	},
	skill: {
		title: "Skills",
		description: "Install skills globally for Cline.",
		emptyInstalled: "No skills installed. Browse the marketplace to add one.",
		emptyCatalog: "No skills match the current filters.",
		icon: Zap,
	},
	plugin: {
		title: "Plugins",
		description: "Install plugins into this CLI environment.",
		emptyInstalled: "No plugins installed. Browse the marketplace to add one.",
		emptyCatalog: "No plugins match the current filters.",
		icon: Puzzle,
	},
} satisfies Record<MarketplacePrimitiveType, MarketplacePageDetails>;

const directoryPageDetails: MarketplacePageDetails = {
	title: "Marketplace",
	description:
		"A curated set of plugins, MCP servers, and skills from the Cline community.",
	emptyInstalled: "Nothing installed yet.",
	emptyCatalog: "No marketplace entries match the current filters.",
	icon: Store,
};

const TYPE_FILTER_LABELS: Record<MarketplacePrimitiveType, string> = {
	plugin: "Plugins",
	mcp: "MCP servers",
	skill: "Skills",
};

const TYPE_FILTER_ORDER: MarketplacePrimitiveType[] = [
	"plugin",
	"mcp",
	"skill",
];

const primitiveCommands = {
	mcp: "cline mcp install",
	plugin: "cline plugin install",
	skill: "cline skill add",
} satisfies Record<MarketplacePrimitiveType, string>;

export type MarketplaceLocalInstalledItemRenderContext = {
	matchedEntries?: MarketplaceEntry[];
};

export type MarketplaceLocalInstalledItem = {
	key: string;
	matchValues: string[];
	render: (context?: MarketplaceLocalInstalledItemRenderContext) => ReactNode;
};

function entryKey(entry: Pick<MarketplaceEntry, "id" | "type">): string {
	return `${entry.type}:${entry.id}`;
}

function compareFeaturedEntries(
	left: MarketplaceEntry,
	right: MarketplaceEntry,
): number {
	return Number(Boolean(right.featured)) - Number(Boolean(left.featured));
}

function normalizeMatchValue(value: string): string {
	return value.trim().toLowerCase();
}

function entryMatchValues(entry: MarketplaceEntry): Set<string> {
	return new Set(
		[entry.id, entry.name, ...entry.install.args]
			.map(normalizeMatchValue)
			.filter(Boolean),
	);
}

function entryMatchesLocalItem(
	entry: MarketplaceEntry,
	item: MarketplaceLocalInstalledItem,
): boolean {
	const entryValues = entryMatchValues(entry);
	return item.matchValues
		.map(normalizeMatchValue)
		.filter(Boolean)
		.some((value) => entryValues.has(value));
}

function entrySearchText(
	entry: MarketplaceEntry,
	tagLabels: Map<string, string>,
): string {
	return [
		entry.name,
		entry.tagline,
		entry.description,
		entry.type,
		...entry.tags.map((tag) => tagLabels.get(tag) ?? tag),
	]
		.join(" ")
		.toLowerCase();
}

function actionMessage(
	state: EntryActionState | undefined,
): string | undefined {
	if (
		state?.status === "installed" ||
		state?.status === "uninstalled" ||
		state?.status === "failed"
	) {
		return state.message;
	}
	return undefined;
}

function entryHasSetupGuidance(entry: MarketplaceEntry): boolean {
	return Boolean(entry.install.env?.length) || Boolean(entry.install.notes);
}

function EntrySetupGuidance({ entry }: { entry: MarketplaceEntry }) {
	const requiredEnv =
		entry.install.env?.filter((env) => env.required !== false) ?? [];
	const optionalEnv =
		entry.install.env?.filter((env) => env.required === false) ?? [];

	return (
		<>
			{requiredEnv.length > 0 || optionalEnv.length > 0 ? (
				<div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
					<p className="text-sm font-medium text-amber-800 dark:text-amber-200">
						Environment setup needed
					</p>
					<p className="mt-1 text-xs leading-5 text-amber-800/80 dark:text-amber-100/80">
						Add these values to your Cline/plugin environment after install.
					</p>
					<div className="mt-3 grid gap-2">
						{[...requiredEnv, ...optionalEnv].map((env) => (
							<div
								key={env.name}
								className="rounded-md border border-amber-500/20 bg-background/60 p-2"
							>
								<div className="flex items-center justify-between gap-2">
									<code className="font-mono text-xs font-semibold">
										<span style={CODE_FONT_STYLE}>{env.name}</span>
									</code>
									<Badge variant="outline">
										{env.required === false ? "Optional" : "Required"}
									</Badge>
								</div>
								{env.description ? (
									<p className="mt-1 text-xs text-muted-foreground">
										{env.description}
									</p>
								) : null}
								{env.url ? (
									<a
										className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
										href={env.url}
										onAuxClick={(event) => {
											if (event.button !== 1) return;
											event.preventDefault();
											if (env.url) void openExternalUrl(env.url);
										}}
										onClick={(event) => {
											event.preventDefault();
											if (env.url) void openExternalUrl(env.url);
										}}
										rel="noreferrer"
										target="_blank"
									>
										Get value
										<ExternalLink className="size-3" />
									</a>
								) : null}
							</div>
						))}
					</div>
				</div>
			) : null}

			{entry.install.notes ? (
				<p className="rounded-lg border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
					{entry.install.notes}
				</p>
			) : null}
		</>
	);
}

function EntryDetails({
	actionState,
	entry,
}: {
	actionState: EntryActionState | undefined;
	entry: MarketplaceEntry;
}) {
	const hasSetupDetails =
		entryHasSetupGuidance(entry) || actionState?.status === "failed";

	if (!hasSetupDetails) {
		return null;
	}

	return (
		<div className="grid gap-3 border-t pt-3" data-marketplace-entry-details>
			<EntrySetupGuidance entry={entry} />

			{actionState?.status === "failed" ? (
				<div className="max-h-44 overflow-auto rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
					{actionState.message}
				</div>
			) : null}
		</div>
	);
}

/**
 * Collapsible marketplace setup guidance (required env vars and install notes)
 * for locally installed items that were matched to marketplace entries. When a
 * local item matches several entries, each entry's guidance is shown under its
 * own labeled trigger so no instructions are hidden or misattributed.
 */
export function MarketplaceEntrySetupDetails({
	entries,
}: {
	entries: MarketplaceEntry[];
}) {
	const entriesWithGuidance = entries.filter(entryHasSetupGuidance);
	if (entriesWithGuidance.length === 0) {
		return null;
	}

	return (
		<div className="grid gap-2">
			{entriesWithGuidance.map((entry) => (
				<Collapsible className="grid gap-2" key={entryKey(entry)}>
					<CollapsibleTrigger asChild>
						<button
							type="button"
							className="group flex w-fit items-center gap-1 text-xs text-amber-700 transition-colors hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200"
						>
							<ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
							{entriesWithGuidance.length > 1
								? `Marketplace setup instructions (${entry.name})`
								: "Marketplace setup instructions"}
						</button>
					</CollapsibleTrigger>
					<CollapsibleContent className="grid gap-3">
						<EntrySetupGuidance entry={entry} />
					</CollapsibleContent>
				</Collapsible>
			))}
		</div>
	);
}

function MarketplaceEntryCard({
	actionState,
	entry,
	expanded,
	installed,
	installedStatusReady,
	onInstall,
	onToggleExpanded,
	onUninstall,
	showFeatured = true,
	showTags = true,
	sourceLabel,
	tagLabels,
}: {
	actionState: EntryActionState | undefined;
	entry: MarketplaceEntry;
	expanded: boolean;
	installed: boolean;
	installedStatusReady: boolean;
	onInstall: (entry: MarketplaceEntry) => void;
	onToggleExpanded: (entry: MarketplaceEntry) => void;
	onUninstall: (entry: MarketplaceEntry) => void;
	showFeatured?: boolean;
	showTags?: boolean;
	sourceLabel?: string;
	tagLabels: Map<string, string>;
}) {
	const EntryIcon = primitivePageDetails[entry.type].icon;
	const busy =
		actionState?.status === "installing" ||
		actionState?.status === "uninstalling";
	const setupNeeded = Boolean(entry.install.env?.length);
	const hasExpandableDetails =
		setupNeeded ||
		Boolean(entry.install.notes) ||
		actionState?.status === "failed";
	const inlineMessage = actionMessage(actionState);
	const handleActionClick = (event: MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation();
		if (installed) {
			onUninstall(entry);
			return;
		}
		onInstall(entry);
	};
	const actionLabel = !installedStatusReady
		? "Checking..."
		: actionState?.status === "installing"
			? "Installing..."
			: actionState?.status === "uninstalling"
				? "Uninstalling..."
				: installed
					? "Uninstall"
					: "Install";
	const statusMessage = inlineMessage ? (
		<output
			className={cn(
				"text-xs",
				actionState?.status === "failed"
					? "text-destructive"
					: "text-muted-foreground",
			)}
		>
			{inlineMessage}
		</output>
	) : setupNeeded ? (
		<span className="text-xs text-amber-700 dark:text-amber-300">
			Requires setup after install
		</span>
	) : null;
	const actionButton = (
		<Button
			disabled={!installedStatusReady || busy}
			onClick={handleActionClick}
			size="xs"
			type="button"
			variant={installed ? "destructive" : "default"}
		>
			{busy || !installedStatusReady ? <Spinner /> : null}
			{installed && !busy ? <Trash2 className="size-4" /> : null}
			{actionLabel}
		</Button>
	);
	const content = (
		<>
			<div
				className="absolute top-4 right-4"
				data-marketplace-entry-interactive
			>
				{actionButton}
			</div>
			<div className="min-w-0">
				<div className="flex min-w-0 items-center gap-2 pr-28">
					<EntryIcon className="h-4 w-4 shrink-0 text-primary" />
					<h2 className="min-w-0 truncate text-sm font-semibold text-foreground">
						{entry.name}
					</h2>
					{showFeatured && entry.featured ? (
						<Badge className="border border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300">
							<Star className="fill-current" />
							Featured
						</Badge>
					) : null}
					{sourceLabel ? (
						<Badge variant="outline" className="shrink-0 text-muted-foreground">
							{sourceLabel}
						</Badge>
					) : null}
				</div>
			</div>

			<div className="grid min-w-0 gap-2">
				{showTags && entry.tags.length > 0 ? (
					<div className="flex flex-wrap gap-1.5">
						{entry.tags.slice(0, 5).map((tag) => (
							<Badge
								key={tag}
								variant="outline"
								className="max-w-full text-muted-foreground"
							>
								<span className="truncate">{tagLabels.get(tag) ?? tag}</span>
							</Badge>
						))}
					</div>
				) : null}

				<p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
					{entry.description}
				</p>
				{statusMessage}
			</div>

			{expanded && hasExpandableDetails ? (
				<EntryDetails actionState={actionState} entry={entry} />
			) : null}
		</>
	);

	if (!hasExpandableDetails) {
		return (
			<div className="relative grid min-w-0 gap-2 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-surface-hover-lighter">
				{content}
			</div>
		);
	}

	return (
		// biome-ignore lint/a11y/useSemanticElements: The card contains a nested action button, so the wrapper cannot be a native button.
		<div
			aria-expanded={expanded}
			aria-label={`${expanded ? "Collapse" : "Expand"} ${entry.name}`}
			className="relative grid min-w-0 cursor-pointer gap-2 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-surface-hover-lighter focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
			onClick={(event) => {
				if (
					event.target instanceof HTMLElement &&
					event.target.closest(
						"[data-marketplace-entry-details], [data-marketplace-entry-interactive]",
					)
				) {
					return;
				}
				onToggleExpanded(entry);
			}}
			onKeyDown={(event) => {
				if (event.target !== event.currentTarget) {
					return;
				}
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onToggleExpanded(entry);
				}
			}}
			role="button"
			tabIndex={0}
		>
			{content}
		</div>
	);
}

function TagButton({
	active,
	count,
	onClick,
	tag,
}: {
	active: boolean;
	count: number;
	onClick: () => void;
	tag: MarketplaceTag;
}) {
	return (
		<Button
			aria-pressed={active}
			onClick={onClick}
			size="sm"
			type="button"
			variant={active ? "default" : "outline"}
		>
			<span className="truncate">{tag.label}</span>
			<span className="rounded bg-background/30 px-1.5 py-0.5 text-xs">
				{count}
			</span>
		</Button>
	);
}

type MarketplaceLocalInstalledListItem = {
	item: MarketplaceLocalInstalledItem;
	matchedEntries: MarketplaceEntry[];
};

function MarketplaceSection({
	actionStates,
	emptyMessage,
	entries,
	expandedEntryKey,
	headerContent,
	installedEntryKeys,
	installedStatusReady,
	localInstalledItems = [],
	onInstall,
	onToggleExpanded,
	onUninstall,
	showFeaturedBadges = true,
	showEntryTags = true,
	sourceLabel,
	tagLabels,
	title,
}: {
	actionStates: Map<string, EntryActionState>;
	emptyMessage: string;
	entries: MarketplaceEntry[];
	expandedEntryKey: string | null;
	headerContent?: ReactNode;
	installedEntryKeys: Set<string>;
	installedStatusReady: boolean;
	localInstalledItems?: MarketplaceLocalInstalledListItem[];
	onInstall: (entry: MarketplaceEntry) => void;
	onToggleExpanded: (entry: MarketplaceEntry) => void;
	onUninstall: (entry: MarketplaceEntry) => void;
	showFeaturedBadges?: boolean;
	showEntryTags?: boolean;
	sourceLabel?: string;
	tagLabels: Map<string, string>;
	title?: string;
}) {
	const totalCount = entries.length + localInstalledItems.length;
	return (
		<section className="grid min-w-0 gap-3">
			{title ? (
				<div className="flex items-center justify-between gap-3">
					<h2 className="text-base font-semibold text-foreground">{title}</h2>
					<span className="text-sm text-muted-foreground">{totalCount}</span>
				</div>
			) : null}
			{headerContent}
			{totalCount > 0 ? (
				<div className="grid min-w-0 gap-3">
					{localInstalledItems.map(({ item, matchedEntries }) =>
						item.render({ matchedEntries }),
					)}
					{entries.map((entry) => {
						const key = entryKey(entry);
						return (
							<MarketplaceEntryCard
								actionState={actionStates.get(key)}
								entry={entry}
								expanded={expandedEntryKey === key}
								installed={installedEntryKeys.has(key)}
								installedStatusReady={installedStatusReady}
								key={key}
								onInstall={onInstall}
								onToggleExpanded={onToggleExpanded}
								onUninstall={onUninstall}
								showFeatured={showFeaturedBadges}
								showTags={showEntryTags}
								sourceLabel={sourceLabel}
								tagLabels={tagLabels}
							/>
						);
					})}
				</div>
			) : (
				<div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
					{emptyMessage}
				</div>
			)}
		</section>
	);
}

export type MarketplaceViewVariant = "full" | "installed" | "directory";

export function MarketplaceView({
	chrome = "page",
	defaultTypeFilter,
	installedItems,
	onInstalledItemsChanged,
	onOpenInstalled,
	primitive,
	variant = "full",
}: {
	chrome?: "page" | "embedded";
	/** Preselected type filter chip in the all-types directory variant. */
	defaultTypeFilter?: MarketplacePrimitiveType;
	installedItems?: MarketplaceLocalInstalledItem[];
	onInstalledItemsChanged?: () => void | Promise<void>;
	/** Renders an Installed button in the directory page header. */
	onOpenInstalled?: () => void;
	/** When omitted, the view spans every catalog type (directory variant). */
	primitive?: MarketplacePrimitiveType;
	variant?: MarketplaceViewVariant;
}) {
	const [catalog, setCatalog] = useState<MarketplaceCatalog | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [selectedTag, setSelectedTag] = useState<string | null>(null);
	const [typeFilter, setTypeFilter] = useState<MarketplacePrimitiveType | null>(
		defaultTypeFilter ?? null,
	);
	const [expandedEntryKey, setExpandedEntryKey] = useState<string | null>(null);
	const [installedEntryKeys, setInstalledEntryKeys] = useState<Set<string>>(
		() => new Set(),
	);
	const [actionStates, setActionStates] = useState<
		Map<string, EntryActionState>
	>(() => new Map());
	const [installedStatusState, setInstalledStatusState] =
		useState<InstalledStatusState>("loading");
	// Bumped on every optimistic installed-keys mutation so that recheck
	// responses issued before the mutation are discarded instead of clobbering
	// the newer optimistic state.
	const installedStatusVersionRef = useRef(0);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const nextCatalog = await fetchMarketplaceCatalog();
				if (!cancelled) {
					setCatalog(nextCatalog);
					setErrorMessage(null);
				}
			} catch (error) {
				if (!cancelled) {
					setErrorMessage(
						error instanceof Error ? error.message : String(error),
					);
					setInstalledStatusState("ready");
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	// Recheck installed status whenever the locally installed items change (e.g.
	// after a server is deleted through its own card controls) so marketplace
	// entries do not keep a stale installed state.
	const installedItemsSignature = useMemo(
		() =>
			JSON.stringify(
				(installedItems ?? []).map((item) => [item.key, ...item.matchValues]),
			),
		[installedItems],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: installedItemsSignature intentionally retriggers the installed-status check when local items change
	useEffect(() => {
		if (!catalog) {
			return;
		}
		let cancelled = false;
		const requestVersion = installedStatusVersionRef.current;
		void (async () => {
			try {
				const response =
					await desktopClient.invoke<MarketplaceInstallStatusResult>(
						"list_marketplace_installed_entries",
						{ entries: catalog.entries },
					);
				if (
					!cancelled &&
					installedStatusVersionRef.current === requestVersion
				) {
					setInstalledEntryKeys(new Set(response.installedKeys));
				}
			} catch {
				// Keep the current installed status when the recheck fails.
			} finally {
				if (!cancelled) {
					setInstalledStatusState("ready");
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [catalog, installedItemsSignature]);

	const pageDetails = primitive
		? primitivePageDetails[primitive]
		: directoryPageDetails;
	const tagLabels = useMemo(
		() => new Map(catalog?.tags.map((tag) => [tag.id, tag.label]) ?? []),
		[catalog?.tags],
	);

	const primitiveEntries = useMemo(
		() =>
			(
				catalog?.entries.filter(
					(entry) => !primitive || entry.type === primitive,
				) ?? []
			).sort(compareFeaturedEntries),
		[catalog?.entries, primitive],
	);

	const queryFilteredEntries = useMemo(() => {
		const normalizedQuery = query.trim().toLowerCase();
		return primitiveEntries.filter((entry) => {
			return (
				normalizedQuery.length === 0 ||
				entrySearchText(entry, tagLabels).includes(normalizedQuery)
			);
		});
	}, [primitiveEntries, query, tagLabels]);

	// Assign each installed marketplace entry to at most one local item so a
	// single entry's badge and setup guidance are never duplicated across
	// unrelated local cards that happen to share a broad match value.
	const matchedEntriesByLocalItemKey = useMemo(() => {
		const matched = new Map<string, MarketplaceEntry[]>();
		const items = installedItems ?? [];
		const installedMarketplaceEntries = primitiveEntries.filter((entry) =>
			installedEntryKeys.has(entryKey(entry)),
		);
		for (const entry of installedMarketplaceEntries) {
			const candidates = items.filter((item) =>
				entryMatchesLocalItem(entry, item),
			);
			let target = candidates.length === 1 ? candidates[0] : undefined;
			if (!target && candidates.length > 1) {
				// Prefer the item that matches the entry's own id or name over
				// items that only share a weaker value (e.g. an install argument
				// or a path segment).
				const strongValues = new Set(
					[entry.id, entry.name].map(normalizeMatchValue).filter(Boolean),
				);
				const strongCandidates = candidates.filter((item) =>
					item.matchValues
						.map(normalizeMatchValue)
						.some((value) => strongValues.has(value)),
				);
				target =
					strongCandidates.length === 1 ? strongCandidates[0] : undefined;
			}
			if (!target) {
				// Still ambiguous: keep the entry on its own marketplace card
				// rather than guessing which local item it belongs to.
				continue;
			}
			const entries = matched.get(target.key) ?? [];
			entries.push(entry);
			matched.set(target.key, entries);
		}
		return matched;
	}, [installedEntryKeys, installedItems, primitiveEntries]);

	const matchedEntryKeys = useMemo(
		() =>
			new Set(
				[...matchedEntriesByLocalItemKey.values()].flatMap((entries) =>
					entries.map((entry) => entryKey(entry)),
				),
			),
		[matchedEntriesByLocalItemKey],
	);

	// Installed entry keys that are corroborated by at least one local item,
	// regardless of which single item the entry was assigned to above.
	const locallyEvidencedEntryKeys = useMemo(() => {
		const items = installedItems ?? [];
		return new Set(
			primitiveEntries
				.filter(
					(entry) =>
						installedEntryKeys.has(entryKey(entry)) &&
						items.some((item) => entryMatchesLocalItem(entry, item)),
				)
				.map((entry) => entryKey(entry)),
		);
	}, [installedEntryKeys, installedItems, primitiveEntries]);

	// When an entry loses all local items backing it (e.g. the matching server
	// was deleted through its own card controls), drop its installed key right
	// away so the entry moves back to the Marketplace section without waiting
	// for the async recheck above — which could be slow or fail and briefly
	// resurrect the entry as an installed card.
	const previouslyEvidencedEntryKeysRef = useRef<Set<string>>(new Set());
	useEffect(() => {
		const orphanedKeys = [...previouslyEvidencedEntryKeysRef.current].filter(
			(key) => !locallyEvidencedEntryKeys.has(key),
		);
		previouslyEvidencedEntryKeysRef.current = locallyEvidencedEntryKeys;
		if (orphanedKeys.length === 0) {
			return;
		}
		installedStatusVersionRef.current += 1;
		setInstalledEntryKeys((current) => {
			const next = new Set(current);
			for (const key of orphanedKeys) {
				next.delete(key);
			}
			return next;
		});
	}, [locallyEvidencedEntryKeys]);

	// Installed marketplace entries that have a matching local item are rendered
	// through that item's own card, so only unmatched entries fall back to the
	// marketplace entry card here.
	const installedEntries = useMemo(
		() =>
			queryFilteredEntries.filter(
				(entry) =>
					installedEntryKeys.has(entryKey(entry)) &&
					!matchedEntryKeys.has(entryKey(entry)),
			),
		[queryFilteredEntries, installedEntryKeys, matchedEntryKeys],
	);

	// The directory variant is a single browsable list of every catalog entry
	// (installed entries stay in place with an Uninstall action); other
	// variants keep not-yet-installed entries in the catalog section only.
	const catalogEntriesBeforeTag = useMemo(
		() =>
			variant === "directory"
				? queryFilteredEntries.filter(
						(entry) => !typeFilter || entry.type === typeFilter,
					)
				: queryFilteredEntries.filter(
						(entry) => !installedEntryKeys.has(entryKey(entry)),
					),
		[queryFilteredEntries, installedEntryKeys, typeFilter, variant],
	);

	const tagCounts = useMemo(() => {
		const counts = new Map<string, number>();
		for (const entry of catalogEntriesBeforeTag) {
			for (const tag of entry.tags) {
				counts.set(tag, (counts.get(tag) ?? 0) + 1);
			}
		}
		return counts;
	}, [catalogEntriesBeforeTag]);

	const typeCounts = useMemo(() => {
		const counts = new Map<MarketplacePrimitiveType, number>();
		for (const entry of queryFilteredEntries) {
			counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
		}
		return counts;
	}, [queryFilteredEntries]);

	// Keep the selected tag's chip visible even when the current type/query has
	// no matches for it, so an active filter can never silently empty the list
	// while its chip is hidden.
	const primitiveTags = useMemo(
		() =>
			(catalog?.tags ?? []).filter(
				(tag) => (tagCounts.get(tag.id) ?? 0) > 0 || tag.id === selectedTag,
			),
		[catalog?.tags, selectedTag, tagCounts],
	);

	const catalogEntries = useMemo(
		() =>
			catalogEntriesBeforeTag.filter(
				(entry) => !selectedTag || entry.tags.includes(selectedTag),
			),
		[catalogEntriesBeforeTag, selectedTag],
	);

	const localInstalledItems = useMemo(() => {
		const normalizedQuery = query.trim().toLowerCase();
		return (installedItems ?? [])
			.map(
				(item): MarketplaceLocalInstalledListItem => ({
					item,
					matchedEntries: matchedEntriesByLocalItemKey.get(item.key) ?? [],
				}),
			)
			.filter(({ item, matchedEntries }) => {
				if (normalizedQuery.length === 0) {
					return true;
				}
				if (
					item.matchValues
						.map(normalizeMatchValue)
						.some((value) => value.includes(normalizedQuery))
				) {
					return true;
				}
				return matchedEntries.some((entry) =>
					entrySearchText(entry, tagLabels).includes(normalizedQuery),
				);
			});
	}, [installedItems, matchedEntriesByLocalItemKey, query, tagLabels]);

	const installedStatusReady = installedStatusState === "ready";

	const typeFilterChips =
		variant === "directory" && !primitive ? (
			<div className="flex min-w-0 flex-wrap gap-2">
				<Button
					aria-pressed={typeFilter === null}
					onClick={() => setTypeFilter(null)}
					size="sm"
					type="button"
					variant={typeFilter === null ? "default" : "outline"}
				>
					All
					<span className="rounded bg-background/30 px-1.5 py-0.5 text-xs">
						{queryFilteredEntries.length}
					</span>
				</Button>
				{TYPE_FILTER_ORDER.map((type) => (
					<Button
						aria-pressed={typeFilter === type}
						key={type}
						onClick={() =>
							setTypeFilter((current) => (current === type ? null : type))
						}
						size="sm"
						type="button"
						variant={typeFilter === type ? "default" : "outline"}
					>
						{TYPE_FILTER_LABELS[type]}
						<span className="rounded bg-background/30 px-1.5 py-0.5 text-xs">
							{typeCounts.get(type) ?? 0}
						</span>
					</Button>
				))}
			</div>
		) : null;

	const marketplaceTagFilters =
		primitiveTags.length > 0 ? (
			<div className="flex min-w-0 flex-wrap items-center gap-2">
				{primitiveTags.map((tag) => (
					<TagButton
						active={selectedTag === tag.id}
						count={tagCounts.get(tag.id) ?? 0}
						key={tag.id}
						onClick={() =>
							setSelectedTag((current) => (current === tag.id ? null : tag.id))
						}
						tag={tag}
					/>
				))}
				{/* Clearing belongs with what it clears: the control appears at
				    the end of the chip row only while a tag is active. */}
				{selectedTag ? (
					<Button
						className="text-muted-foreground"
						onClick={() => setSelectedTag(null)}
						size="sm"
						type="button"
						variant="ghost"
					>
						<X className="size-3.5" />
						Clear
					</Button>
				) : null}
			</div>
		) : null;

	const setEntryState = (entry: MarketplaceEntry, state: EntryActionState) => {
		const key = entryKey(entry);
		setActionStates((current) => {
			const next = new Map(current);
			next.set(key, state);
			return next;
		});
	};

	const markEntryInstalled = (entry: MarketplaceEntry) => {
		installedStatusVersionRef.current += 1;
		setInstalledEntryKeys((current) => new Set(current).add(entryKey(entry)));
	};

	const markEntryUninstalled = (entry: MarketplaceEntry) => {
		installedStatusVersionRef.current += 1;
		setInstalledEntryKeys((current) => {
			const next = new Set(current);
			next.delete(entryKey(entry));
			return next;
		});
	};

	const toggleExpanded = (entry: MarketplaceEntry) => {
		const key = entryKey(entry);
		setExpandedEntryKey((current) => (current === key ? null : key));
	};

	const installEntry = async (entry: MarketplaceEntry) => {
		const key = entryKey(entry);
		const currentState = actionStates.get(key);
		if (
			currentState?.status === "installing" ||
			currentState?.status === "uninstalling"
		) {
			return;
		}
		setExpandedEntryKey(key);
		setEntryState(entry, { status: "installing" });
		try {
			const result = await desktopClient.invoke<MarketplaceInstallResult>(
				"install_marketplace_entry",
				{ entry },
				{ timeoutMs: INSTALL_TIMEOUT_MS },
			);
			setEntryState(entry, {
				status: "installed",
				message: result.message,
			});
			markEntryInstalled(entry);
			await onInstalledItemsChanged?.();
		} catch (error) {
			setEntryState(entry, {
				status: "failed",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	};

	const uninstallEntry = async (entry: MarketplaceEntry) => {
		const key = entryKey(entry);
		const currentState = actionStates.get(key);
		if (
			currentState?.status === "installing" ||
			currentState?.status === "uninstalling"
		) {
			return;
		}
		setExpandedEntryKey(key);
		setEntryState(entry, { status: "uninstalling" });
		try {
			const result = await desktopClient.invoke<MarketplaceInstallResult>(
				"uninstall_marketplace_entry",
				{ entry },
				{ timeoutMs: INSTALL_TIMEOUT_MS },
			);
			setEntryState(entry, {
				status: "uninstalled",
				message: result.message,
			});
			markEntryUninstalled(entry);
			await onInstalledItemsChanged?.();
		} catch (error) {
			setEntryState(entry, {
				status: "failed",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	};

	const content = (
		<div className="grid gap-6">
			{chrome === "page" ? (
				<PageHeader
					description={pageDetails.description}
					title={pageDetails.title}
					meta={
						primitive ? (
							<CommandBadge>{primitiveCommands[primitive]}</CommandBadge>
						) : undefined
					}
					actions={
						onOpenInstalled ? (
							<Button
								onClick={onOpenInstalled}
								size="sm"
								type="button"
								variant="outline"
							>
								<Blocks className="size-4" />
								Installed
							</Button>
						) : undefined
					}
				/>
			) : null}

			{!catalog && !errorMessage ? (
				<div className="flex min-h-80 items-center justify-center rounded-lg border bg-card text-sm text-muted-foreground">
					<Spinner className="mr-2" />
					Loading marketplace...
				</div>
			) : null}

			{catalog && !installedStatusReady ? (
				<div className="flex min-h-80 items-center justify-center rounded-lg border bg-card text-sm text-muted-foreground">
					<Spinner className="mr-2" />
					Checking installed status...
				</div>
			) : null}

			{errorMessage ? (
				<div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
					{errorMessage}
				</div>
			) : null}

			{catalog && installedStatusReady ? (
				<div className="grid gap-6">
					<div className="grid gap-3">
						<div className="flex flex-col gap-3 md:flex-row md:items-center">
							<div className="relative block flex-1">
								<Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
								<Input
									aria-label={`Search ${pageDetails.title}`}
									className="h-10 pl-8"
									onChange={(event) => setQuery(event.target.value)}
									placeholder={`Search ${pageDetails.title.toLowerCase()}`}
									value={query}
								/>
							</div>
						</div>
					</div>

					{variant !== "directory" ? (
						<MarketplaceSection
							actionStates={actionStates}
							emptyMessage={pageDetails.emptyInstalled}
							entries={installedEntries}
							expandedEntryKey={expandedEntryKey}
							installedEntryKeys={installedEntryKeys}
							installedStatusReady={installedStatusReady}
							localInstalledItems={localInstalledItems}
							onInstall={installEntry}
							onToggleExpanded={toggleExpanded}
							onUninstall={uninstallEntry}
							showFeaturedBadges={false}
							showEntryTags={false}
							sourceLabel="Marketplace"
							tagLabels={tagLabels}
							title="Installed"
						/>
					) : null}

					{variant !== "installed" ? (
						<MarketplaceSection
							actionStates={actionStates}
							emptyMessage={pageDetails.emptyCatalog}
							entries={catalogEntries}
							expandedEntryKey={expandedEntryKey}
							headerContent={
								typeFilterChips || marketplaceTagFilters ? (
									variant === "directory" ? (
										// Light rules separate the filter tiers from each
										// other and from the results below.
										<div className="grid min-w-0 gap-3">
											{typeFilterChips}
											{marketplaceTagFilters ? (
												<>
													<div
														aria-hidden="true"
														className="h-px bg-border/70"
													/>
													{marketplaceTagFilters}
												</>
											) : null}
											<div aria-hidden="true" className="h-px bg-border/70" />
										</div>
									) : (
										<div className="grid min-w-0 gap-2">
											{typeFilterChips}
											{marketplaceTagFilters}
										</div>
									)
								) : null
							}
							installedEntryKeys={installedEntryKeys}
							installedStatusReady={installedStatusReady}
							onInstall={installEntry}
							onToggleExpanded={toggleExpanded}
							onUninstall={uninstallEntry}
							tagLabels={tagLabels}
							title={variant === "directory" ? undefined : "Browse"}
						/>
					) : null}
				</div>
			) : null}
		</div>
	);

	return chrome === "embedded" ? content : <PageFrame>{content}</PageFrame>;
}
