import {
	ArrowDownAZ,
	ArrowUpRight,
	BadgeCheck,
	ChevronDown,
	Scale,
	Search,
	Star,
	Trash2,
	X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type {
	MarketplaceEntry,
	MarketplacePrimitiveType,
} from "@/lib/marketplace";
import { cn } from "@/lib/utils";
import {
	actionLabelFor,
	EntryGlyph,
	entryKey,
	entrySearchText,
	isBusy,
	learnMoreUrl,
	MATURITY_ORDER,
	type MarketplaceDirectory,
	openLearnMore,
	TYPE_META,
	useMarketplaceDirectory,
} from "./shared";

/**
 * Direction C: "Registry" — a dense, data-forward directory in the spirit of
 * npm / crates.io. Maturity-tiered sections (Skills, MCP, plugins) with
 * compact rows that surface every catalog fact: author, license, verified
 * state, tags, and a learn-more link out to the browser.
 */

type SortMode = "featured" | "name" | "author";

const COLLAPSED_ROW_COUNT = 8;

function sortEntries(entries: MarketplaceEntry[], mode: SortMode) {
	const sorted = [...entries];
	if (mode === "name") {
		sorted.sort((a, b) => a.name.localeCompare(b.name));
	} else if (mode === "author") {
		sorted.sort((a, b) =>
			(a.author?.name ?? "\uffff").localeCompare(b.author?.name ?? "\uffff"),
		);
	} else {
		sorted.sort(
			(a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)),
		);
	}
	return sorted;
}

function RegistryRow({
	directory,
	entry,
}: {
	directory: MarketplaceDirectory;
	entry: MarketplaceEntry;
}) {
	const key = entryKey(entry);
	const state = directory.actionStates.get(key);
	const installed = directory.installedKeys.has(key);
	const busy = isBusy(state);
	const message =
		state?.status === "installed" ||
		state?.status === "uninstalled" ||
		state?.status === "failed"
			? state.message
			: undefined;
	const url = learnMoreUrl(entry);

	return (
		<div className="grid gap-1 px-4 py-3 transition-colors hover:bg-surface-hover-lighter">
			<div className="flex min-w-0 items-center gap-3">
				<EntryGlyph
					className="size-8 text-xs"
					entry={entry}
					rounded="rounded-md"
				/>
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
						<span className="truncate text-sm font-semibold text-foreground">
							{entry.name}
						</span>
						{entry.verified ? (
							<BadgeCheck className="size-3.5 shrink-0 text-sky-500" />
						) : null}
						{entry.featured ? (
							<Star className="size-3 shrink-0 fill-current text-violet-500" />
						) : null}
						{entry.author ? (
							<span className="truncate text-xs text-muted-foreground">
								{entry.author.name}
							</span>
						) : null}
						{entry.license ? (
							<span className="inline-flex items-center gap-0.5 rounded border border-border/70 px-1 py-px text-[10px] text-muted-foreground">
								<Scale className="size-2.5" />
								{entry.license}
							</span>
						) : null}
						{entry.tags.slice(0, 2).map((tag) => (
							<span
								className="rounded bg-muted px-1 py-px text-[10px] text-muted-foreground"
								key={tag}
							>
								{directory.tagLabels.get(tag) ?? tag}
							</span>
						))}
					</div>
					<p className="truncate text-xs text-muted-foreground">
						{entry.tagline}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					{url ? (
						<Button
							aria-label={`Learn more about ${entry.name}`}
							className="text-muted-foreground"
							onClick={() => openLearnMore(entry)}
							size="xs"
							title={url}
							type="button"
							variant="ghost"
						>
							<ArrowUpRight className="size-4" />
						</Button>
					) : null}
					<Button
						className="w-22"
						disabled={!directory.installedReady || busy}
						onClick={() =>
							installed
								? void directory.uninstall(entry)
								: void directory.install(entry)
						}
						size="xs"
						type="button"
						variant={installed ? "destructive" : "outline"}
					>
						{busy || !directory.installedReady ? <Spinner /> : null}
						{installed && !busy ? <Trash2 className="size-3.5" /> : null}
						{actionLabelFor(state, installed, directory.installedReady)}
					</Button>
				</div>
			</div>
			{message ? (
				<output
					className={cn(
						"line-clamp-2 pl-11 text-xs",
						state?.status === "failed"
							? "text-destructive"
							: "text-muted-foreground",
					)}
				>
					{message}
				</output>
			) : null}
		</div>
	);
}

function RegistrySection({
	directory,
	entries,
	type,
}: {
	directory: MarketplaceDirectory;
	entries: MarketplaceEntry[];
	type: MarketplacePrimitiveType;
}) {
	const [showAll, setShowAll] = useState(false);
	const meta = TYPE_META[type];
	const Icon = meta.icon;
	if (entries.length === 0) return null;
	const visible = showAll ? entries : entries.slice(0, COLLAPSED_ROW_COUNT);
	const hiddenCount = entries.length - visible.length;
	return (
		<section className="grid min-w-0 gap-2" id={`registry-${type}`}>
			<div className="flex flex-wrap items-center gap-2">
				<Icon className="size-4 text-primary" />
				<h2 className="text-base font-semibold text-foreground">
					{meta.plural}
				</h2>
				<span className="text-sm text-muted-foreground">{entries.length}</span>
				<Badge className="border border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
					{meta.maturity}
				</Badge>
				<span className="text-xs text-muted-foreground">{meta.blurb}</span>
			</div>
			<div className="divide-y overflow-hidden rounded-xl border bg-card">
				{visible.map((entry) => (
					<RegistryRow
						directory={directory}
						entry={entry}
						key={entryKey(entry)}
					/>
				))}
				{hiddenCount > 0 || showAll ? (
					<button
						className="flex w-full items-center justify-center gap-1 px-4 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-hover-lighter hover:text-foreground"
						onClick={() => setShowAll((current) => !current)}
						type="button"
					>
						<ChevronDown
							className={cn(
								"size-3.5 transition-transform",
								showAll && "rotate-180",
							)}
						/>
						{showAll ? "Show fewer" : `Show all ${entries.length}`}
					</button>
				) : null}
			</div>
		</section>
	);
}

function StatTile({
	active,
	count,
	onClick,
	type,
}: {
	active: boolean;
	count: number;
	onClick: () => void;
	type: MarketplacePrimitiveType;
}) {
	const meta = TYPE_META[type];
	const Icon = meta.icon;
	return (
		<button
			aria-pressed={active}
			className={cn(
				"flex min-w-0 flex-1 items-center gap-3 rounded-xl border bg-card p-4 text-left transition-colors",
				active
					? "border-primary/50 bg-primary/5"
					: "hover:bg-surface-hover-lighter",
			)}
			onClick={onClick}
			type="button"
		>
			<Icon className="size-5 shrink-0 text-primary" />
			<span className="min-w-0">
				<span className="block text-lg font-semibold leading-6 text-foreground">
					{count}
				</span>
				<span className="block truncate text-xs text-muted-foreground">
					{meta.plural} · {meta.maturity}
				</span>
			</span>
		</button>
	);
}

export function RegistryMarketplaceView() {
	const directory = useMarketplaceDirectory();
	const [query, setQuery] = useState("");
	const [sortMode, setSortMode] = useState<SortMode>("featured");
	const [typeFilter, setTypeFilter] = useState<MarketplacePrimitiveType | null>(
		null,
	);
	const [selectedTag, setSelectedTag] = useState<string | null>(null);

	const filteredEntries = useMemo(() => {
		const entries = directory.catalog?.entries ?? [];
		const normalized = query.trim().toLowerCase();
		return entries.filter(
			(entry) =>
				(!typeFilter || entry.type === typeFilter) &&
				(!selectedTag || entry.tags.includes(selectedTag)) &&
				(normalized.length === 0 ||
					entrySearchText(entry, directory.tagLabels).includes(normalized)),
		);
	}, [
		directory.catalog?.entries,
		directory.tagLabels,
		query,
		selectedTag,
		typeFilter,
	]);

	const sections = useMemo(
		() =>
			MATURITY_ORDER.map((type) => ({
				type,
				entries: sortEntries(
					filteredEntries.filter((entry) => entry.type === type),
					sortMode,
				),
			})),
		[filteredEntries, sortMode],
	);

	const typeCounts = useMemo(() => {
		const counts = new Map<MarketplacePrimitiveType, number>();
		for (const entry of directory.catalog?.entries ?? []) {
			counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
		}
		return counts;
	}, [directory.catalog?.entries]);

	return (
		<ScrollArea className="h-full">
			<div className="px-18 py-10 max-[1200px]:px-8 max-[720px]:px-4 max-[720px]:py-5">
				<div className="grid max-w-344 gap-6">
					<section>
						<h1 className="text-3xl font-semibold text-foreground">
							Marketplace
						</h1>
						<p className="mt-2 max-w-2xl text-base text-muted-foreground">
							The full Cline registry, tiered by maturity. Every entry shows its
							author, license, and verification at a glance.
						</p>
					</section>

					{directory.loading ? (
						<div className="flex min-h-80 items-center justify-center rounded-lg border bg-card text-sm text-muted-foreground">
							<Spinner className="mr-2" />
							Loading marketplace...
						</div>
					) : null}

					{directory.errorMessage ? (
						<div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
							{directory.errorMessage}
						</div>
					) : null}

					{directory.catalog ? (
						<>
							<section className="flex gap-3 max-[860px]:flex-col">
								{MATURITY_ORDER.map((type) => (
									<StatTile
										active={typeFilter === type}
										count={typeCounts.get(type) ?? 0}
										key={type}
										onClick={() =>
											setTypeFilter((current) =>
												current === type ? null : type,
											)
										}
										type={type}
									/>
								))}
							</section>

							<section className="flex flex-wrap items-center gap-2">
								<div className="relative min-w-60 flex-1">
									<Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
									<Input
										aria-label="Search registry"
										className="h-9 pl-8"
										onChange={(event) => setQuery(event.target.value)}
										placeholder="Search by name, author, tag..."
										value={query}
									/>
								</div>
								<Select
									onValueChange={(value) => setSortMode(value as SortMode)}
									value={sortMode}
								>
									<SelectTrigger className="h-9 w-44">
										<ArrowDownAZ className="size-4 text-muted-foreground" />
										<SelectValue placeholder="Sort" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="featured">Featured first</SelectItem>
										<SelectItem value="name">Name A–Z</SelectItem>
										<SelectItem value="author">Author A–Z</SelectItem>
									</SelectContent>
								</Select>
								<Select
									onValueChange={(value) =>
										setSelectedTag(value === "all" ? null : value)
									}
									value={selectedTag ?? "all"}
								>
									<SelectTrigger className="h-9 w-44">
										<SelectValue placeholder="Category" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">All categories</SelectItem>
										{(directory.catalog.tags ?? []).map((tag) => (
											<SelectItem key={tag.id} value={tag.id}>
												{tag.label} ({tag.count})
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								{typeFilter || selectedTag || query ? (
									<Button
										className="text-muted-foreground"
										onClick={() => {
											setTypeFilter(null);
											setSelectedTag(null);
											setQuery("");
										}}
										size="sm"
										type="button"
										variant="ghost"
									>
										<X className="size-3.5" />
										Clear
									</Button>
								) : null}
							</section>

							{sections.map((section) => (
								<RegistrySection
									directory={directory}
									entries={section.entries}
									key={section.type}
									type={section.type}
								/>
							))}

							{filteredEntries.length === 0 ? (
								<div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
									No registry entries match the current filters.
								</div>
							) : null}
						</>
					) : null}
				</div>
			</div>
		</ScrollArea>
	);
}
