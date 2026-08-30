import {
	ArrowUpRight,
	BadgeCheck,
	Github,
	Globe,
	Puzzle,
	Scale,
	Search,
	Server,
	Trash2,
	User,
	X,
	Zap,
} from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import {
	fetchMarketplaceCatalog,
	type MarketplaceCatalog,
	type MarketplaceEntry,
	type MarketplacePrimitiveType,
} from "@/lib/marketplace";
import { cn } from "@/lib/utils";

/**
 * Marketplace explorer: a two-pane master/detail directory in the spirit of
 * an IDE extensions panel. The left rail lists every catalog entry grouped by
 * primitive maturity (Skills, then MCP, then plugins); the right pane is a
 * full detail page for the selected entry with the catalog's metadata
 * (author, license, verified state, tags, install command, env setup) and
 * links out to the entry's homepage and repository.
 */

/** Ordered most-mature first: skills > MCP servers > plugins. */
const MATURITY_ORDER: MarketplacePrimitiveType[] = ["skill", "mcp", "plugin"];

type TypeMeta = {
	label: string;
	plural: string;
	icon: typeof Server;
};

const TYPE_META: Record<MarketplacePrimitiveType, TypeMeta> = {
	skill: {
		label: "Skill",
		plural: "Skills",
		icon: Zap,
	},
	mcp: {
		label: "MCP Server",
		plural: "MCP",
		icon: Server,
	},
	plugin: {
		label: "Plugin",
		plural: "Plugins",
		icon: Puzzle,
	},
};

const CODE_FONT_STYLE: CSSProperties = {
	fontFamily:
		'"Geist Mono Variable", ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
};

const INSTALL_TIMEOUT_MS = 300_000;

/** Tag pills shown while the category row is collapsed. */
const COLLAPSED_TAG_COUNT = 4;

function entryKey(entry: Pick<MarketplaceEntry, "id" | "type">): string {
	return `${entry.type}:${entry.id}`;
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
		entry.author?.name ?? "",
		...entry.tags.map((tag) => tagLabels.get(tag) ?? tag),
	]
		.join(" ")
		.toLowerCase();
}

type EntryActionState =
	| { status: "idle" }
	| { status: "installing" }
	| { status: "uninstalling" }
	| { status: "installed"; message: string }
	| { status: "uninstalled"; message: string }
	| { status: "failed"; message: string };

type MarketplaceInstallResult = {
	status: "installed" | "uninstalled";
	message: string;
	output?: string;
};

type MarketplaceInstallStatusResult = {
	installedKeys: string[];
};

type MarketplaceDirectory = {
	catalog: MarketplaceCatalog | null;
	errorMessage: string | null;
	loading: boolean;
	tagLabels: Map<string, string>;
	installedKeys: Set<string>;
	installedReady: boolean;
	actionStates: Map<string, EntryActionState>;
	install: (entry: MarketplaceEntry) => Promise<void>;
	uninstall: (entry: MarketplaceEntry) => Promise<void>;
};

function useMarketplaceDirectory(): MarketplaceDirectory {
	const [catalog, setCatalog] = useState<MarketplaceCatalog | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [installedKeys, setInstalledKeys] = useState<Set<string>>(
		() => new Set(),
	);
	const [installedReady, setInstalledReady] = useState(false);
	const [actionStates, setActionStates] = useState<
		Map<string, EntryActionState>
	>(() => new Map());

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
					setInstalledReady(true);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!catalog) return;
		let cancelled = false;
		void (async () => {
			try {
				const response =
					await desktopClient.invoke<MarketplaceInstallStatusResult>(
						"list_marketplace_installed_entries",
						{ entries: catalog.entries },
					);
				if (!cancelled) {
					setInstalledKeys(new Set(response.installedKeys));
				}
			} catch {
				// Keep current installed status when the check fails.
			} finally {
				if (!cancelled) {
					setInstalledReady(true);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [catalog]);

	const tagLabels = useMemo(
		() => new Map(catalog?.tags.map((tag) => [tag.id, tag.label]) ?? []),
		[catalog?.tags],
	);

	const setEntryState = (entry: MarketplaceEntry, state: EntryActionState) => {
		const key = entryKey(entry);
		setActionStates((current) => {
			const next = new Map(current);
			next.set(key, state);
			return next;
		});
	};

	const install = async (entry: MarketplaceEntry) => {
		const key = entryKey(entry);
		const current = actionStates.get(key);
		if (
			current?.status === "installing" ||
			current?.status === "uninstalling"
		) {
			return;
		}
		setEntryState(entry, { status: "installing" });
		try {
			const result = await desktopClient.invoke<MarketplaceInstallResult>(
				"install_marketplace_entry",
				{ entry },
				{ timeoutMs: INSTALL_TIMEOUT_MS },
			);
			setEntryState(entry, { status: "installed", message: result.message });
			setInstalledKeys((prev) => new Set(prev).add(key));
		} catch (error) {
			setEntryState(entry, {
				status: "failed",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	};

	const uninstall = async (entry: MarketplaceEntry) => {
		const key = entryKey(entry);
		const current = actionStates.get(key);
		if (
			current?.status === "installing" ||
			current?.status === "uninstalling"
		) {
			return;
		}
		setEntryState(entry, { status: "uninstalling" });
		try {
			const result = await desktopClient.invoke<MarketplaceInstallResult>(
				"uninstall_marketplace_entry",
				{ entry },
				{ timeoutMs: INSTALL_TIMEOUT_MS },
			);
			setEntryState(entry, { status: "uninstalled", message: result.message });
			setInstalledKeys((prev) => {
				const next = new Set(prev);
				next.delete(key);
				return next;
			});
		} catch (error) {
			setEntryState(entry, {
				status: "failed",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	};

	return {
		catalog,
		errorMessage,
		loading: !catalog && !errorMessage,
		tagLabels,
		installedKeys,
		installedReady,
		actionStates,
		install,
		uninstall,
	};
}

function actionLabelFor(
	state: EntryActionState | undefined,
	installed: boolean,
	ready: boolean,
): string {
	if (!ready) return "Checking...";
	if (state?.status === "installing") return "Installing...";
	if (state?.status === "uninstalling") return "Uninstalling...";
	return installed ? "Uninstall" : "Install";
}

function isBusy(state: EntryActionState | undefined): boolean {
	return state?.status === "installing" || state?.status === "uninstalling";
}

function ListRow({
	entry,
	installed,
	onSelect,
	selected,
}: {
	entry: MarketplaceEntry;
	installed: boolean;
	onSelect: () => void;
	selected: boolean;
}) {
	return (
		<button
			className={cn(
				"flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
				selected ? "bg-primary/10" : "hover:bg-surface-hover-lighter",
			)}
			onClick={onSelect}
			type="button"
		>
			<span className="min-w-0 flex-1">
				<span className="flex min-w-0 items-center gap-1">
					<span className="truncate text-sm font-medium text-foreground">
						{entry.name}
					</span>
					{entry.verified ? (
						<BadgeCheck className="size-3.5 shrink-0 text-sky-500" />
					) : null}
				</span>
				<span className="block truncate text-xs text-muted-foreground">
					{entry.tagline}
				</span>
			</span>
			{installed ? (
				<span
					className="size-1.5 shrink-0 rounded-full bg-emerald-500"
					title="Installed"
				/>
			) : null}
		</button>
	);
}

function MetaCell({
	icon: Icon,
	label,
	onOpen,
	value,
}: {
	icon: typeof Globe;
	label: string;
	onOpen?: () => void;
	value: string;
}) {
	const content = (
		<>
			<span className="flex items-center gap-1 text-xs text-muted-foreground">
				<Icon className="size-3" />
				{label}
			</span>
			<span
				className={cn(
					"mt-0.5 block truncate text-sm font-medium text-foreground",
					onOpen && "group-hover:underline",
				)}
			>
				{value}
			</span>
		</>
	);
	if (onOpen) {
		return (
			<button
				className="group min-w-0 rounded-md text-left"
				onClick={onOpen}
				type="button"
			>
				{content}
			</button>
		);
	}
	return <div className="min-w-0">{content}</div>;
}

function DetailPane({
	directory,
	entry,
	onSelectTag,
}: {
	directory: MarketplaceDirectory;
	entry: MarketplaceEntry;
	onSelectTag: (tag: string) => void;
}) {
	const meta = TYPE_META[entry.type];
	const key = entryKey(entry);
	const state = directory.actionStates.get(key);
	const installed = directory.installedKeys.has(key);
	const busy = isBusy(state);
	const requiredEnv =
		entry.install.env?.filter((env) => env.required !== false) ?? [];
	const optionalEnv =
		entry.install.env?.filter((env) => env.required === false) ?? [];
	const message =
		state?.status === "installed" ||
		state?.status === "uninstalled" ||
		state?.status === "failed"
			? state.message
			: undefined;

	return (
		<ScrollArea className="h-full min-w-0 flex-1">
			<div className="mx-auto grid max-w-3xl gap-6 px-8 py-8 max-[900px]:px-5">
				<div className="flex items-start gap-5">
					<div className="min-w-0 flex-1">
						<div className="flex min-w-0 flex-wrap items-center gap-2">
							<h1 className="min-w-0 truncate text-2xl font-semibold text-foreground">
								{entry.name}
							</h1>
							{entry.verified ? (
								<Badge className="border border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300">
									<BadgeCheck />
									Verified
								</Badge>
							) : null}
							<Badge variant="outline" className="text-muted-foreground">
								{meta.label}
							</Badge>
						</div>
						<p className="mt-1 text-sm text-muted-foreground">
							{entry.tagline}
						</p>
						<div className="mt-4 flex flex-wrap items-center gap-2">
							<Button
								disabled={!directory.installedReady || busy}
								onClick={() =>
									installed
										? void directory.uninstall(entry)
										: void directory.install(entry)
								}
								size="sm"
								type="button"
								variant={installed ? "destructive" : "default"}
							>
								{busy || !directory.installedReady ? <Spinner /> : null}
								{installed && !busy ? <Trash2 className="size-4" /> : null}
								{actionLabelFor(state, installed, directory.installedReady)}
							</Button>
							{entry.homepage ? (
								<Button
									onClick={() => void openExternalUrl(entry.homepage as string)}
									size="sm"
									type="button"
									variant="outline"
								>
									<Globe className="size-4" />
									Learn more
									<ArrowUpRight className="size-3.5 text-muted-foreground" />
								</Button>
							) : null}
							{entry.repo ? (
								<Button
									onClick={() => void openExternalUrl(entry.repo as string)}
									size="sm"
									type="button"
									variant="outline"
								>
									<Github className="size-4" />
									Repository
									<ArrowUpRight className="size-3.5 text-muted-foreground" />
								</Button>
							) : null}
						</div>
						{message ? (
							<output
								className={cn(
									"mt-2 block text-xs",
									state?.status === "failed"
										? "text-destructive"
										: "text-muted-foreground",
								)}
							>
								{message}
							</output>
						) : null}
					</div>
				</div>

				<div className="grid grid-cols-3 gap-4 rounded-xl border bg-card p-4 max-[720px]:grid-cols-2">
					{entry.author ? (
						<MetaCell
							icon={User}
							label="Author"
							onOpen={
								entry.author.url
									? () => void openExternalUrl(entry.author?.url as string)
									: undefined
							}
							value={entry.author.name}
						/>
					) : null}
					<MetaCell
						icon={Scale}
						label="License"
						value={entry.license ?? "Not specified"}
					/>
					<MetaCell icon={meta.icon} label="Type" value={meta.plural} />
				</div>

				<section className="grid gap-2">
					<h2 className="text-sm font-semibold text-foreground">About</h2>
					<p className="text-sm leading-6 text-muted-foreground">
						{entry.description}
					</p>
					{entry.tags.length > 0 ? (
						<div className="mt-1 flex flex-wrap gap-1.5">
							{entry.tags.map((tag) => (
								<button
									key={tag}
									onClick={() => onSelectTag(tag)}
									title={`Filter by ${directory.tagLabels.get(tag) ?? tag}`}
									type="button"
								>
									<Badge
										className="cursor-pointer text-muted-foreground transition-colors hover:bg-surface-hover-lighter hover:text-foreground"
										variant="outline"
									>
										{directory.tagLabels.get(tag) ?? tag}
									</Badge>
								</button>
							))}
						</div>
					) : null}
				</section>

				{requiredEnv.length > 0 || optionalEnv.length > 0 ? (
					<section className="grid gap-2">
						<h2 className="text-sm font-semibold text-foreground">
							Environment setup
						</h2>
						<div className="grid gap-2">
							{[...requiredEnv, ...optionalEnv].map((env) => (
								<div className="rounded-lg border bg-card p-3" key={env.name}>
									<div className="flex items-center justify-between gap-2">
										<code
											className="text-xs font-semibold"
											style={CODE_FONT_STYLE}
										>
											{env.name}
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
										<button
											className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
											onClick={() => void openExternalUrl(env.url as string)}
											type="button"
										>
											Get value
											<ArrowUpRight className="size-3" />
										</button>
									) : null}
								</div>
							))}
						</div>
					</section>
				) : null}

				{entry.install.notes ? (
					<p className="rounded-lg border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
						{entry.install.notes}
					</p>
				) : null}
			</div>
		</ScrollArea>
	);
}

export function MarketplaceExplorerView() {
	const directory = useMarketplaceDirectory();
	const [query, setQuery] = useState("");
	const [typeFilter, setTypeFilter] = useState<MarketplacePrimitiveType | null>(
		null,
	);
	const [selectedTag, setSelectedTag] = useState<string | null>(null);
	const [tagsExpanded, setTagsExpanded] = useState(false);
	const [selectedKey, setSelectedKey] = useState<string | null>(null);

	// Type + query filtering happens before tag filtering so the tag pill
	// counts reflect what each tag would narrow the current list down to.
	const typeAndQueryEntries = useMemo(() => {
		const entries = directory.catalog?.entries ?? [];
		const normalized = query.trim().toLowerCase();
		return entries.filter(
			(entry) =>
				(!typeFilter || entry.type === typeFilter) &&
				(normalized.length === 0 ||
					entrySearchText(entry, directory.tagLabels).includes(normalized)),
		);
	}, [directory.catalog?.entries, directory.tagLabels, query, typeFilter]);

	const tagCounts = useMemo(() => {
		const counts = new Map<string, number>();
		for (const entry of typeAndQueryEntries) {
			for (const tag of entry.tags) {
				counts.set(tag, (counts.get(tag) ?? 0) + 1);
			}
		}
		return counts;
	}, [typeAndQueryEntries]);

	// Keep the selected tag's pill visible even when the current type/query
	// has no matches for it, so an active filter can never silently empty the
	// list while its pill is hidden. Sorted by the catalog's global tag count
	// (static) so the collapsed row surfaces the most useful categories
	// without pills reordering as filters change.
	const visibleTags = useMemo(
		() =>
			(directory.catalog?.tags ?? [])
				.filter(
					(tag) => (tagCounts.get(tag.id) ?? 0) > 0 || tag.id === selectedTag,
				)
				.sort((a, b) => b.count - a.count),
		[directory.catalog?.tags, selectedTag, tagCounts],
	);

	// Collapsed, the pill row shows only the top categories (plus the active
	// tag if it would otherwise be hidden) and a "+N more" toggle.
	const displayedTags = useMemo(() => {
		if (tagsExpanded) return visibleTags;
		const slice = visibleTags.slice(0, COLLAPSED_TAG_COUNT);
		if (selectedTag && !slice.some((tag) => tag.id === selectedTag)) {
			const selected = visibleTags.find((tag) => tag.id === selectedTag);
			if (selected) slice.push(selected);
		}
		return slice;
	}, [selectedTag, tagsExpanded, visibleTags]);

	const hiddenTagCount = visibleTags.length - displayedTags.length;

	const filteredEntries = useMemo(
		() =>
			typeAndQueryEntries.filter(
				(entry) => !selectedTag || entry.tags.includes(selectedTag),
			),
		[typeAndQueryEntries, selectedTag],
	);

	const groups = useMemo(
		() =>
			MATURITY_ORDER.map((type) => ({
				type,
				entries: filteredEntries
					.filter((entry) => entry.type === type)
					.sort(
						(a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)),
					),
			})).filter((group) => group.entries.length > 0),
		[filteredEntries],
	);

	const selectedEntry = useMemo(() => {
		const flat = groups.flatMap((group) => group.entries);
		return (
			flat.find((entry) => entryKey(entry) === selectedKey) ?? flat[0] ?? null
		);
	}, [groups, selectedKey]);

	const typeCounts = useMemo(() => {
		const counts = new Map<MarketplacePrimitiveType, number>();
		for (const entry of directory.catalog?.entries ?? []) {
			counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
		}
		return counts;
	}, [directory.catalog?.entries]);

	if (directory.loading) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
				<Spinner className="mr-2" />
				Loading marketplace...
			</div>
		);
	}

	if (directory.errorMessage) {
		return (
			<div className="p-8">
				<div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
					{directory.errorMessage}
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 min-w-0">
			<aside className="flex w-85 shrink-0 flex-col border-r max-[900px]:w-72">
				<div className="grid gap-2.5 border-b p-3">
					<div className="relative">
						<Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							aria-label="Search marketplace"
							className="h-9 pl-8"
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search marketplace"
							value={query}
						/>
					</div>
					<div className="flex flex-wrap gap-1.5">
						<Button
							aria-pressed={typeFilter === null}
							onClick={() => setTypeFilter(null)}
							size="xs"
							type="button"
							variant={typeFilter === null ? "default" : "outline"}
						>
							All
						</Button>
						{MATURITY_ORDER.map((type) => (
							<Button
								aria-pressed={typeFilter === type}
								key={type}
								onClick={() =>
									setTypeFilter((current) => (current === type ? null : type))
								}
								size="xs"
								type="button"
								variant={typeFilter === type ? "default" : "outline"}
							>
								{TYPE_META[type].plural}
								<span className="text-[10px] opacity-70">
									{typeCounts.get(type) ?? 0}
								</span>
							</Button>
						))}
					</div>
					{visibleTags.length > 0 ? (
						<div className="flex flex-wrap gap-1">
							{displayedTags.map((tag) => {
								const active = selectedTag === tag.id;
								return (
									<button
										aria-pressed={active}
										className={cn(
											"inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
											active
												? "border-primary/50 bg-primary/10 text-primary"
												: "border-border/70 text-muted-foreground hover:bg-surface-hover-lighter hover:text-foreground",
										)}
										key={tag.id}
										onClick={() =>
											setSelectedTag((current) =>
												current === tag.id ? null : tag.id,
											)
										}
										type="button"
									>
										{tag.label}
										{active ? (
											<X className="size-3" />
										) : (
											<span className="opacity-60">
												{tagCounts.get(tag.id) ?? 0}
											</span>
										)}
									</button>
								);
							})}
							{hiddenTagCount > 0 || tagsExpanded ? (
								<button
									className="inline-flex items-center rounded-full border border-dashed border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-surface-hover-lighter hover:text-foreground"
									onClick={() => setTagsExpanded((current) => !current)}
									type="button"
								>
									{tagsExpanded ? "Show less" : `+${hiddenTagCount} more`}
								</button>
							) : null}
						</div>
					) : null}
				</div>
				<ScrollArea className="min-h-0 flex-1">
					<div className="grid gap-4 p-2 pb-6">
						{groups.map((group) => {
							const meta = TYPE_META[group.type];
							const Icon = meta.icon;
							return (
								<div className="grid gap-1" key={group.type}>
									<div className="flex items-center gap-1.5 px-2.5 pt-1">
										<Icon className="size-3.5 text-primary" />
										<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
											{meta.plural}
										</span>
										<span className="text-xs text-muted-foreground/70">
											{group.entries.length}
										</span>
									</div>
									{group.entries.map((entry) => {
										const key = entryKey(entry);
										return (
											<ListRow
												entry={entry}
												installed={directory.installedKeys.has(key)}
												key={key}
												onSelect={() => setSelectedKey(key)}
												selected={
													selectedEntry !== null &&
													entryKey(selectedEntry) === key
												}
											/>
										);
									})}
								</div>
							);
						})}
						{groups.length === 0 ? (
							<p className="px-3 py-6 text-center text-sm text-muted-foreground">
								No entries match the current filters.
							</p>
						) : null}
					</div>
				</ScrollArea>
			</aside>
			{selectedEntry ? (
				<DetailPane
					directory={directory}
					entry={selectedEntry}
					onSelectTag={setSelectedTag}
				/>
			) : (
				<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
					Select an entry to see details.
				</div>
			)}
		</div>
	);
}
