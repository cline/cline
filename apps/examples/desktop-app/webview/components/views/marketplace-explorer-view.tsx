import {
	ArrowUpRight,
	BadgeCheck,
	Cable,
	ChevronDown,
	Globe,
	Puzzle,
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { fetchComposioStatus } from "@/lib/composio";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import {
	fetchMarketplaceCatalog,
	type MarketplaceCatalog,
	type MarketplaceEntry,
	type MarketplacePrimitiveType,
} from "@/lib/marketplace";
import { cn } from "@/lib/utils";
import {
	MarketplaceListRow,
	MarketplaceTypeGlyph,
	type MarketplaceTypeMeta,
	MarketplaceTypePill,
} from "./marketplace-list-row";
import { ComposioConnectorsView } from "./settings/composio-connectors-view";

/**
 * Marketplace explorer: a master/detail directory in the spirit of an IDE
 * extensions panel. Initially the catalog list fills the view, grouped by
 * primitive maturity (Skills, then MCP, then plugins); clicking an entry
 * opens a detail panel with the catalog's metadata (author, verified state,
 * tags, install command, env setup) and a link out to the entry's homepage.
 *
 * Every row carries its type's glyph on a per-type tint, and each section
 * header says what the type is, so a skill, an MCP server, and a connector
 * that share a name (Figma) read as different things rather than duplicates.
 */

/** Ordered most-mature first: skills > MCP servers > plugins. */
const MATURITY_ORDER: MarketplacePrimitiveType[] = ["skill", "mcp", "plugin"];

export type MarketplaceTypeFilter = MarketplacePrimitiveType | "connector";

const TYPE_META: Record<MarketplaceTypeFilter, MarketplaceTypeMeta> = {
	skill: {
		label: "Skill",
		plural: "Skills",
		short: "Skill",
		icon: Zap,
		blurb: "Step-by-step instructions Cline follows for a workflow. No setup.",
		text: "text-amber-600 dark:text-amber-300",
		bg: "bg-amber-500/12",
	},
	mcp: {
		label: "MCP server",
		plural: "MCP servers",
		short: "MCP",
		icon: Server,
		blurb: "Live tools from an external server. You install and configure it.",
		text: "text-sky-600 dark:text-sky-300",
		bg: "bg-sky-500/12",
	},
	plugin: {
		label: "Plugin",
		plural: "Plugins",
		short: "Plugin",
		icon: Puzzle,
		blurb: "A bundle of tools, hooks, and skills built for Cline.",
		text: "text-violet-600 dark:text-violet-300",
		bg: "bg-violet-500/12",
	},
	connector: {
		label: "Connector",
		plural: "Connectors",
		short: "Connector",
		icon: Cable,
		blurb: "Sign in with your account and get hosted tools instantly. No keys.",
		text: "text-emerald-600 dark:text-emerald-300",
		bg: "bg-emerald-500/12",
	},
};

const CODE_FONT_STYLE: CSSProperties = {
	fontFamily:
		'"Geist Mono Variable", ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
};

const INSTALL_TIMEOUT_MS = 300_000;

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

function SectionHeader({
	beta = false,
	meta,
}: {
	beta?: boolean;
	meta: MarketplaceTypeMeta;
}) {
	return (
		<h2 className="flex min-w-0 items-center gap-2 px-2.5 pb-1.5 pt-1">
			<MarketplaceTypeGlyph className="size-5 rounded-md" meta={meta} />
			<span className="shrink-0 text-sm font-semibold text-foreground">
				{meta.plural}
			</span>
			{beta ? <Badge>Beta</Badge> : null}
			<span className="ml-1 min-w-0 flex-1 truncate text-xs text-muted-foreground/80">
				{meta.blurb}
			</span>
		</h2>
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
	onClose,
	onSelectTag,
}: {
	directory: MarketplaceDirectory;
	entry: MarketplaceEntry;
	onClose: () => void;
	onSelectTag: (tag: string) => void;
}) {
	const meta = TYPE_META[entry.type];
	const key = entryKey(entry);
	const state = directory.actionStates.get(key);
	const installed = directory.installedKeys.has(key);
	const busy = isBusy(state);
	// Homepage is usually the entry's docs/product page; the repo is the
	// fallback since many entries set both to the same GitHub URL anyway.
	const learnMoreUrl = entry.homepage ?? entry.repo;
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
			<div className="grid max-w-3xl gap-6 px-8 py-8 max-[900px]:px-5">
				<div className="flex items-start gap-4">
					<MarketplaceTypeGlyph className="size-12 rounded-xl" meta={meta} />
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
							<MarketplaceTypePill meta={meta} />
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
							{learnMoreUrl ? (
								<Button
									onClick={() => void openExternalUrl(learnMoreUrl)}
									size="sm"
									type="button"
									variant="outline"
								>
									<Globe className="size-4" />
									Learn more
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
					<Button
						aria-label="Close details"
						className="shrink-0 text-muted-foreground"
						onClick={onClose}
						size="icon"
						type="button"
						variant="ghost"
					>
						<X className="size-4" />
					</Button>
				</div>

				<div
					className={cn(
						"flex items-start gap-3 rounded-lg p-3 text-xs",
						meta.bg,
					)}
				>
					<meta.icon className={cn("mt-0.5 size-4 shrink-0", meta.text)} />
					<p className="text-foreground/80">
						<span className={cn("font-medium", meta.text)}>{meta.label}.</span>{" "}
						{meta.blurb}
					</p>
				</div>

				{entry.author ? (
					<div className="rounded-xl border bg-card p-4">
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
					</div>
				) : null}

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

export function MarketplaceExplorerView({
	initialTypeFilter = null,
}: {
	initialTypeFilter?: MarketplaceTypeFilter | null;
}) {
	const directory = useMarketplaceDirectory();
	const [query, setQuery] = useState("");
	const [typeFilter, setTypeFilter] = useState<MarketplaceTypeFilter | null>(
		initialTypeFilter,
	);
	const [selectedTag, setSelectedTag] = useState<string | null>(null);
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const [connectorsAvailable, setConnectorsAvailable] = useState(false);
	const [connectorCount, setConnectorCount] = useState<number | null>(null);
	useEffect(() => {
		let cancelled = false;
		const refresh = async () => {
			const status = await fetchComposioStatus().catch(() => null);
			if (!cancelled) setConnectorsAvailable(status?.configured === true);
		};
		void refresh();
		const unsubscribe = desktopClient.subscribe(
			"settings.changed",
			() => void refresh(),
		);
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, []);
	const showConnectors =
		connectorsAvailable &&
		!selectedTag &&
		(typeFilter === null || typeFilter === "connector");
	// Search results across every type sit close together with short
	// sections, so each row also names its type.
	const showTypePills = typeFilter === null && query.trim().length > 0;

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

	// Keep the selected tag listed even when the current type/query has no
	// matches for it, so an active filter can never silently empty the list
	// while its option is hidden. Sorted by the catalog's global tag count
	// (static) so options don't reorder as filters change.
	const visibleTags = useMemo(
		() =>
			(directory.catalog?.tags ?? [])
				.filter(
					(tag) => (tagCounts.get(tag.id) ?? 0) > 0 || tag.id === selectedTag,
				)
				.sort((a, b) => b.count - a.count),
		[directory.catalog?.tags, selectedTag, tagCounts],
	);

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

	// Resolved against the full catalog so an open panel stays open while the
	// list is filtered, rather than closing and reopening as filters change.
	const selectedEntry = useMemo(
		() =>
			directory.catalog?.entries.find(
				(entry) => entryKey(entry) === selectedKey,
			) ?? null,
		[directory.catalog?.entries, selectedKey],
	);

	const typeCounts = useMemo(() => {
		const counts = new Map<MarketplacePrimitiveType, number>();
		for (const entry of directory.catalog?.entries ?? []) {
			counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
		}
		return counts;
	}, [directory.catalog?.entries]);

	return (
		<div className="flex h-full min-h-0 min-w-0 select-text">
			<aside
				className={cn(
					"flex flex-col",
					selectedEntry
						? "w-85 shrink-0 border-r max-[900px]:w-72"
						: "min-w-0 flex-1",
				)}
			>
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
					<div className="flex flex-wrap items-center gap-1.5">
						<Button
							aria-pressed={typeFilter === null}
							onClick={() => setTypeFilter(null)}
							size="xs"
							type="button"
							variant={typeFilter === null ? "default" : "outline"}
						>
							All
						</Button>
						{MATURITY_ORDER.map((type) => {
							const meta = TYPE_META[type];
							const active = typeFilter === type;
							return (
								<Button
									aria-pressed={active}
									key={type}
									onClick={() =>
										setTypeFilter((current) => (current === type ? null : type))
									}
									size="xs"
									type="button"
									variant={active ? "default" : "outline"}
								>
									<meta.icon className={cn("size-3.5", !active && meta.text)} />
									{meta.plural}
									<span className="text-[10px] opacity-70">
										{typeCounts.get(type) ?? 0}
									</span>
								</Button>
							);
						})}
						{connectorsAvailable ? (
							<Button
								aria-pressed={typeFilter === "connector"}
								onClick={() => {
									setTypeFilter((current) =>
										current === "connector" ? null : "connector",
									);
									setSelectedTag(null);
									setSelectedKey(null);
								}}
								size="xs"
								type="button"
								variant={typeFilter === "connector" ? "default" : "outline"}
							>
								<Cable
									className={cn(
										"size-3.5",
										typeFilter !== "connector" && TYPE_META.connector.text,
									)}
								/>
								Connectors
								<span className="text-[10px] opacity-70">
									{connectorCount ?? "…"}
								</span>
							</Button>
						) : null}
						{typeFilter !== "connector" && visibleTags.length > 0 ? (
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										aria-label="Filter by category"
										className="ml-auto text-muted-foreground"
										size="xs"
										type="button"
										variant="ghost"
									>
										{selectedTag
											? (directory.tagLabels.get(selectedTag) ?? selectedTag)
											: "All categories"}
										<ChevronDown className="size-3.5" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" className="w-60">
									<DropdownMenuRadioGroup
										onValueChange={(value) =>
											setSelectedTag(value === "" ? null : value)
										}
										value={selectedTag ?? ""}
									>
										<DropdownMenuRadioItem value="">
											All categories
										</DropdownMenuRadioItem>
										{visibleTags.map((tag) => (
											<DropdownMenuRadioItem key={tag.id} value={tag.id}>
												{tag.label}
												<span className="ml-auto text-xs text-muted-foreground">
													{tagCounts.get(tag.id) ?? 0}
												</span>
											</DropdownMenuRadioItem>
										))}
									</DropdownMenuRadioGroup>
								</DropdownMenuContent>
							</DropdownMenu>
						) : null}
					</div>
				</div>
				<ScrollArea className="min-h-0 flex-1">
					<div className="grid gap-4 p-2 pb-6">
						{typeFilter !== "connector" && directory.loading ? (
							<p className="flex items-center justify-center p-6 text-sm text-muted-foreground">
								<Spinner className="mr-2" />
								Loading marketplace...
							</p>
						) : null}
						{typeFilter !== "connector" && directory.errorMessage ? (
							<p className="p-4 text-sm text-destructive" role="alert">
								{directory.errorMessage}
							</p>
						) : null}
						{groups.map((group) => {
							const meta = TYPE_META[group.type];
							return (
								<div className="grid gap-0.5" key={group.type}>
									<SectionHeader meta={meta} />
									{group.entries.map((entry) => {
										const key = entryKey(entry);
										return (
											<MarketplaceListRow
												name={entry.name}
												description={entry.tagline}
												meta={meta}
												showType={showTypePills}
												verified={entry.verified}
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
						{groups.length === 0 &&
						!showConnectors &&
						!directory.loading &&
						!directory.errorMessage ? (
							<p className="px-3 py-6 text-center text-sm text-muted-foreground">
								No entries match the current filters.
							</p>
						) : null}
						{showConnectors ? (
							<section className="grid gap-0.5" aria-label="Connectors">
								<SectionHeader beta meta={TYPE_META.connector} />
								<ComposioConnectorsView
									appendOnScroll
									searchQuery={query}
									onCatalogCountChange={setConnectorCount}
									renderItem={({ entry, status, onOpenDetails, selected }) => (
										<MarketplaceListRow
											name={entry.name}
											description={entry.description}
											meta={TYPE_META.connector}
											showType={showTypePills}
											installed={status === "connected"}
											selected={selected}
											onSelect={onOpenDetails}
										/>
									)}
								/>
							</section>
						) : null}
					</div>
				</ScrollArea>
			</aside>
			{selectedEntry ? (
				<DetailPane
					directory={directory}
					entry={selectedEntry}
					onClose={() => setSelectedKey(null)}
					onSelectTag={setSelectedTag}
				/>
			) : null}
		</div>
	);
}
