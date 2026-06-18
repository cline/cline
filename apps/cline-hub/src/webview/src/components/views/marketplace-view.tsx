import {
	CheckCircle2,
	ExternalLink,
	Plug,
	Search,
	Server,
	Trash2,
	Wrench,
} from "lucide-react";
import {
	type CSSProperties,
	type MouseEvent,
	type ReactNode,
	useEffect,
	useMemo,
	useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { desktopClient } from "@/lib/desktop-client";
import {
	fetchMarketplaceCatalog,
	type MarketplaceCatalog,
	type MarketplaceEntry,
	type MarketplacePrimitiveType,
	type MarketplaceTag,
} from "@/lib/marketplace";
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
		'ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
};

const primitivePageDetails = {
	mcp: {
		title: "MCP Servers",
		description:
			"Install Model Context Protocol servers into this CLI environment.",
		emptyInstalled: "No MCP servers installed.",
		emptyCatalog: "No MCP servers match the current filters.",
		icon: Server,
	},
	skill: {
		title: "Skills",
		description: "Install skills globally for Cline.",
		emptyInstalled: "No skills installed.",
		emptyCatalog: "No skills match the current filters.",
		icon: Wrench,
	},
	plugin: {
		title: "Plugins",
		description: "Install plugins into this CLI environment.",
		emptyInstalled: "No plugins installed.",
		emptyCatalog: "No plugins match the current filters.",
		icon: Plug,
	},
} satisfies Record<
	MarketplacePrimitiveType,
	{
		title: string;
		description: string;
		emptyInstalled: string;
		emptyCatalog: string;
		icon: typeof Server;
	}
>;

const primitiveCommands = {
	mcp: "cline mcp install",
	plugin: "cline plugin install",
	skill: "cline skill add",
} satisfies Record<MarketplacePrimitiveType, string>;

export type MarketplaceLocalInstalledItem = {
	key: string;
	matchValues: string[];
	render: () => ReactNode;
	renderMatchedBadges?: () => ReactNode;
	renderMatchedControls?: () => ReactNode;
	renderMatchedDetails?: () => ReactNode;
	renderMatchedMeta?: () => ReactNode;
};

function entryKey(entry: Pick<MarketplaceEntry, "id" | "type">): string {
	return `${entry.type}:${entry.id}`;
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

function EntryDetails({
	actionState,
	entry,
}: {
	actionState: EntryActionState | undefined;
	entry: MarketplaceEntry;
}) {
	const requiredEnv =
		entry.install.env?.filter((env) => env.required !== false) ?? [];
	const optionalEnv =
		entry.install.env?.filter((env) => env.required === false) ?? [];
	const hasSetupDetails =
		requiredEnv.length > 0 ||
		optionalEnv.length > 0 ||
		Boolean(entry.install.notes) ||
		actionState?.status === "failed";

	if (!hasSetupDetails) {
		return null;
	}

	return (
		<div className="grid gap-3 border-t pt-3" data-marketplace-entry-details>
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

			{actionState?.status === "failed" ? (
				<div className="max-h-44 overflow-auto rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
					{actionState.message}
				</div>
			) : null}
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
	matchedLocalItems = [],
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
	matchedLocalItems?: MarketplaceLocalInstalledItem[];
	sourceLabel?: string;
	tagLabels: Map<string, string>;
}) {
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
	const content = (
		<>
			<div className="min-w-0">
				<div className="flex min-w-0 items-start justify-between gap-2">
					<h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
						{entry.name}
					</h2>
					<div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
						{sourceLabel ? (
							<Badge
								variant="outline"
								className="shrink-0 text-muted-foreground"
							>
								{sourceLabel}
							</Badge>
						) : null}
						{matchedLocalItems.map((item) =>
							item.renderMatchedBadges ? (
								<span className="contents" key={`${item.key}:badges`}>
									{item.renderMatchedBadges()}
								</span>
							) : null,
						)}
						{matchedLocalItems.map((item) =>
							item.renderMatchedControls ? (
								<span
									className="contents"
									data-marketplace-entry-interactive
									key={`${item.key}:controls`}
								>
									{item.renderMatchedControls()}
								</span>
							) : null,
						)}
					</div>
				</div>
				{matchedLocalItems.some((item) => item.renderMatchedMeta) ? (
					<div className="mt-1 grid gap-1">
						{matchedLocalItems.map((item) =>
							item.renderMatchedMeta ? (
								<div key={`${item.key}:meta`}>{item.renderMatchedMeta()}</div>
							) : null,
						)}
					</div>
				) : null}
				<div className="mt-1 flex flex-wrap gap-1.5">
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
			</div>

			<p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
				{entry.description}
			</p>

			{matchedLocalItems.some((item) => item.renderMatchedDetails) ? (
				<div
					className="grid gap-2 rounded-md border bg-muted/20 p-3"
					data-marketplace-entry-details
				>
					{matchedLocalItems.map((item) =>
						item.renderMatchedDetails ? (
							<div key={item.key}>{item.renderMatchedDetails()}</div>
						) : null,
					)}
				</div>
			) : null}

			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="min-h-5 text-xs text-muted-foreground">
					{inlineMessage ? (
						<output
							className={
								actionState?.status === "failed"
									? "text-destructive"
									: "text-muted-foreground"
							}
						>
							{inlineMessage}
						</output>
					) : installed ? (
						<span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
							<CheckCircle2 className="size-3.5" />
							Installed
						</span>
					) : setupNeeded ? (
						<span className="text-amber-700 dark:text-amber-300">
							Requires setup after install
						</span>
					) : null}
				</div>
				<Button
					disabled={!installedStatusReady || busy}
					onClick={handleActionClick}
					type="button"
					variant={installed ? "destructive" : "default"}
				>
					{busy || !installedStatusReady ? <Spinner /> : null}
					{installed && !busy ? <Trash2 className="size-4" /> : null}
					{actionLabel}
				</Button>
			</div>

			{expanded && hasExpandableDetails ? (
				<EntryDetails actionState={actionState} entry={entry} />
			) : null}
		</>
	);

	if (!hasExpandableDetails) {
		return (
			<div className="grid gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent/20">
				{content}
			</div>
		);
	}

	return (
		// biome-ignore lint/a11y/useSemanticElements: The card contains a nested action button, so the wrapper cannot be a native button.
		<div
			aria-expanded={expanded}
			aria-label={`${expanded ? "Collapse" : "Expand"} ${entry.name}`}
			className="grid cursor-pointer gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent/20 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
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

function MarketplaceSection({
	actionStates,
	emptyMessage,
	entries,
	expandedEntryKey,
	installedEntryKeys,
	installedStatusReady,
	localOnlyInstalledItems = [],
	matchedLocalItemsByEntryKey,
	onInstall,
	onToggleExpanded,
	onUninstall,
	sourceLabel,
	tagLabels,
	title,
}: {
	actionStates: Map<string, EntryActionState>;
	emptyMessage: string;
	entries: MarketplaceEntry[];
	expandedEntryKey: string | null;
	installedEntryKeys: Set<string>;
	installedStatusReady: boolean;
	localOnlyInstalledItems?: MarketplaceLocalInstalledItem[];
	matchedLocalItemsByEntryKey?: Map<string, MarketplaceLocalInstalledItem[]>;
	onInstall: (entry: MarketplaceEntry) => void;
	onToggleExpanded: (entry: MarketplaceEntry) => void;
	onUninstall: (entry: MarketplaceEntry) => void;
	sourceLabel?: string;
	tagLabels: Map<string, string>;
	title: string;
}) {
	const totalCount = entries.length + localOnlyInstalledItems.length;
	return (
		<section className="grid gap-3">
			<div className="flex items-center justify-between gap-3">
				<h2 className="text-base font-semibold text-foreground">{title}</h2>
				<span className="text-sm text-muted-foreground">{totalCount}</span>
			</div>
			{totalCount > 0 ? (
				<div className="grid gap-3">
					{localOnlyInstalledItems.map((item) => item.render())}
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
								matchedLocalItems={matchedLocalItemsByEntryKey?.get(key) ?? []}
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

export function MarketplaceView({
	chrome = "page",
	installedItems,
	primitive,
}: {
	chrome?: "page" | "embedded";
	installedItems?: MarketplaceLocalInstalledItem[];
	primitive: MarketplacePrimitiveType;
}) {
	const [catalog, setCatalog] = useState<MarketplaceCatalog | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [selectedTag, setSelectedTag] = useState<string | null>(null);
	const [expandedEntryKey, setExpandedEntryKey] = useState<string | null>(null);
	const [installedEntryKeys, setInstalledEntryKeys] = useState<Set<string>>(
		() => new Set(),
	);
	const [actionStates, setActionStates] = useState<
		Map<string, EntryActionState>
	>(() => new Map());
	const [installedStatusState, setInstalledStatusState] =
		useState<InstalledStatusState>("loading");

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				if (!cancelled) {
					setInstalledStatusState("loading");
				}
				const nextCatalog = await fetchMarketplaceCatalog();
				if (!cancelled) {
					setCatalog(nextCatalog);
					setErrorMessage(null);
				}
				try {
					const response =
						await desktopClient.invoke<MarketplaceInstallStatusResult>(
							"list_marketplace_installed_entries",
							{ entries: nextCatalog.entries },
						);
					if (!cancelled) {
						setInstalledEntryKeys(new Set(response.installedKeys));
						setInstalledStatusState("ready");
					}
				} catch {
					if (!cancelled) {
						setInstalledStatusState("ready");
					}
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

	const pageDetails = primitivePageDetails[primitive];
	const PageIcon = pageDetails.icon;
	const tagLabels = useMemo(
		() => new Map(catalog?.tags.map((tag) => [tag.id, tag.label]) ?? []),
		[catalog?.tags],
	);

	const primitiveEntries = useMemo(
		() => catalog?.entries.filter((entry) => entry.type === primitive) ?? [],
		[catalog?.entries, primitive],
	);

	const tagCounts = useMemo(() => {
		const counts = new Map<string, number>();
		for (const entry of primitiveEntries) {
			for (const tag of entry.tags) {
				counts.set(tag, (counts.get(tag) ?? 0) + 1);
			}
		}
		return counts;
	}, [primitiveEntries]);

	const primitiveTags = useMemo(
		() =>
			(catalog?.tags ?? []).filter((tag) => (tagCounts.get(tag.id) ?? 0) > 0),
		[catalog?.tags, tagCounts],
	);

	const filteredEntries = useMemo(() => {
		const normalizedQuery = query.trim().toLowerCase();
		return primitiveEntries.filter((entry) => {
			const matchesTag = !selectedTag || entry.tags.includes(selectedTag);
			const matchesQuery =
				normalizedQuery.length === 0 ||
				entrySearchText(entry, tagLabels).includes(normalizedQuery);
			return matchesTag && matchesQuery;
		});
	}, [primitiveEntries, query, selectedTag, tagLabels]);

	const matchedLocalItemsByEntryKey = useMemo(() => {
		const matched = new Map<string, MarketplaceLocalInstalledItem[]>();
		for (const item of installedItems ?? []) {
			for (const entry of filteredEntries) {
				const key = entryKey(entry);
				if (
					!installedEntryKeys.has(key) ||
					!entryMatchesLocalItem(entry, item)
				) {
					continue;
				}
				const items = matched.get(key) ?? [];
				items.push(item);
				matched.set(key, items);
			}
		}
		return matched;
	}, [filteredEntries, installedEntryKeys, installedItems]);

	const matchedLocalItemKeys = useMemo(
		() =>
			new Set(
				[...matchedLocalItemsByEntryKey.values()].flatMap((items) =>
					items.map((item) => item.key),
				),
			),
		[matchedLocalItemsByEntryKey],
	);

	const localOnlyInstalledItems = useMemo(
		() =>
			(installedItems ?? []).filter(
				(item) => !matchedLocalItemKeys.has(item.key),
			),
		[installedItems, matchedLocalItemKeys],
	);

	const installedEntries = useMemo(
		() =>
			filteredEntries.filter((entry) =>
				installedEntryKeys.has(entryKey(entry)),
			),
		[filteredEntries, installedEntryKeys],
	);

	const catalogEntries = useMemo(
		() =>
			filteredEntries.filter(
				(entry) => !installedEntryKeys.has(entryKey(entry)),
			),
		[filteredEntries, installedEntryKeys],
	);

	const activeFilters = query.trim().length > 0 || selectedTag !== null;
	const installedStatusReady = installedStatusState === "ready";

	const clearFilters = () => {
		setQuery("");
		setSelectedTag(null);
	};

	const setEntryState = (entry: MarketplaceEntry, state: EntryActionState) => {
		const key = entryKey(entry);
		setActionStates((current) => {
			const next = new Map(current);
			next.set(key, state);
			return next;
		});
	};

	const markEntryInstalled = (entry: MarketplaceEntry) => {
		setInstalledEntryKeys((current) => new Set(current).add(entryKey(entry)));
	};

	const markEntryUninstalled = (entry: MarketplaceEntry) => {
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
					icon={PageIcon}
					title={pageDetails.title}
					meta={<CommandBadge>{primitiveCommands[primitive]}</CommandBadge>}
					actions={
						catalog?.generatedAt ? (
							<p className="text-xs text-muted-foreground">
								Updated{" "}
								{new Intl.DateTimeFormat(undefined, {
									month: "short",
									day: "numeric",
									year: "numeric",
								}).format(new Date(catalog.generatedAt))}
							</p>
						) : null
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
							<div className="flex min-h-8 items-center gap-2 text-sm text-muted-foreground">
								<span className="font-medium text-foreground">
									{filteredEntries.length}
								</span>
								<span>
									{filteredEntries.length === 1 ? "result" : "results"}
								</span>
								{activeFilters ? (
									<Button
										onClick={clearFilters}
										size="sm"
										type="button"
										variant="ghost"
									>
										Clear filters
									</Button>
								) : null}
							</div>
						</div>

						{primitiveTags.length > 0 ? (
							<div className="flex gap-2 overflow-x-auto pb-1">
								{primitiveTags.map((tag) => (
									<TagButton
										active={selectedTag === tag.id}
										count={tagCounts.get(tag.id) ?? 0}
										key={tag.id}
										onClick={() =>
											setSelectedTag((current) =>
												current === tag.id ? null : tag.id,
											)
										}
										tag={tag}
									/>
								))}
							</div>
						) : null}
					</div>

					<MarketplaceSection
						actionStates={actionStates}
						emptyMessage={pageDetails.emptyInstalled}
						entries={installedEntries}
						expandedEntryKey={expandedEntryKey}
						installedEntryKeys={installedEntryKeys}
						installedStatusReady={installedStatusReady}
						localOnlyInstalledItems={localOnlyInstalledItems}
						matchedLocalItemsByEntryKey={matchedLocalItemsByEntryKey}
						onInstall={installEntry}
						onToggleExpanded={toggleExpanded}
						onUninstall={uninstallEntry}
						sourceLabel="Marketplace"
						tagLabels={tagLabels}
						title="Installed"
					/>

					<MarketplaceSection
						actionStates={actionStates}
						emptyMessage={pageDetails.emptyCatalog}
						entries={catalogEntries}
						expandedEntryKey={expandedEntryKey}
						installedEntryKeys={installedEntryKeys}
						installedStatusReady={installedStatusReady}
						onInstall={installEntry}
						onToggleExpanded={toggleExpanded}
						onUninstall={uninstallEntry}
						tagLabels={tagLabels}
						title="Marketplace"
					/>
				</div>
			) : null}
		</div>
	);

	return chrome === "embedded" ? content : <PageFrame>{content}</PageFrame>;
}
