import {
	ArrowUpRight,
	BadgeCheck,
	Search,
	Sparkles,
	Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
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
 * Direction A: "Storefront" — an editorial, app-store style marketplace.
 * A featured spotlight leads, followed by horizontally scrollable shelves
 * ordered by primitive maturity (Skills, then MCP servers, then plugins).
 */

function InstallButton({
	directory,
	entry,
	size = "xs",
}: {
	directory: MarketplaceDirectory;
	entry: MarketplaceEntry;
	size?: "xs" | "sm";
}) {
	const key = entryKey(entry);
	const state = directory.actionStates.get(key);
	const installed = directory.installedKeys.has(key);
	const busy = isBusy(state);
	return (
		<Button
			disabled={!directory.installedReady || busy}
			onClick={(event) => {
				event.stopPropagation();
				if (installed) {
					void directory.uninstall(entry);
				} else {
					void directory.install(entry);
				}
			}}
			size={size}
			type="button"
			variant={installed ? "destructive" : "default"}
		>
			{busy || !directory.installedReady ? <Spinner /> : null}
			{installed && !busy ? <Trash2 className="size-3.5" /> : null}
			{actionLabelFor(state, installed, directory.installedReady)}
		</Button>
	);
}

function LearnMoreLink({ entry }: { entry: MarketplaceEntry }) {
	if (!learnMoreUrl(entry)) return null;
	return (
		<button
			className="inline-flex items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
			onClick={(event) => {
				event.stopPropagation();
				openLearnMore(entry);
			}}
			type="button"
		>
			Learn more
			<ArrowUpRight className="size-3" />
		</button>
	);
}

function StatusLine({
	directory,
	entry,
}: {
	directory: MarketplaceDirectory;
	entry: MarketplaceEntry;
}) {
	const state = directory.actionStates.get(entryKey(entry));
	if (
		state?.status !== "installed" &&
		state?.status !== "uninstalled" &&
		state?.status !== "failed"
	) {
		return null;
	}
	return (
		<output
			className={cn(
				"line-clamp-2 text-xs",
				state.status === "failed"
					? "text-destructive"
					: "text-muted-foreground",
			)}
		>
			{state.message}
		</output>
	);
}

function HeroCard({
	directory,
	entry,
}: {
	directory: MarketplaceDirectory;
	entry: MarketplaceEntry;
}) {
	const meta = TYPE_META[entry.type];
	return (
		<div className="relative flex min-w-0 flex-col justify-between gap-6 overflow-hidden rounded-2xl border bg-card p-6">
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 opacity-[0.07] dark:opacity-[0.14]"
				style={{
					background:
						"radial-gradient(120% 120% at 0% 0%, hsl(265 80% 55%) 0%, transparent 55%), radial-gradient(120% 120% at 100% 100%, hsl(205 85% 50%) 0%, transparent 55%)",
				}}
			/>
			<div className="relative flex items-start gap-4">
				<EntryGlyph
					className="size-16 text-2xl"
					entry={entry}
					rounded="rounded-xl"
				/>
				<div className="min-w-0">
					<div className="flex items-center gap-2 text-xs font-medium text-violet-600 dark:text-violet-300">
						<Sparkles className="size-3.5" />
						Featured {meta.label}
					</div>
					<h3 className="mt-1 truncate text-xl font-semibold text-foreground">
						{entry.name}
					</h3>
					{entry.author ? (
						<p className="truncate text-sm text-muted-foreground">
							by {entry.author.name}
							{entry.verified ? (
								<BadgeCheck className="ml-1 inline size-3.5 text-sky-500" />
							) : null}
						</p>
					) : null}
				</div>
			</div>
			<p className="relative line-clamp-2 text-sm leading-6 text-muted-foreground">
				{entry.tagline}
			</p>
			<div className="relative flex items-center gap-3">
				<InstallButton directory={directory} entry={entry} size="sm" />
				<LearnMoreLink entry={entry} />
			</div>
			<StatusLine directory={directory} entry={entry} />
		</div>
	);
}

function FeaturedMiniCard({
	directory,
	entry,
}: {
	directory: MarketplaceDirectory;
	entry: MarketplaceEntry;
}) {
	return (
		<div className="flex min-w-0 items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-surface-hover-lighter">
			<EntryGlyph className="size-10 text-sm" entry={entry} />
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-center gap-1">
					<span className="truncate text-sm font-medium text-foreground">
						{entry.name}
					</span>
					{entry.verified ? (
						<BadgeCheck className="size-3.5 shrink-0 text-sky-500" />
					) : null}
				</div>
				<p className="truncate text-xs text-muted-foreground">
					{entry.tagline}
				</p>
			</div>
			<InstallButton directory={directory} entry={entry} />
		</div>
	);
}

function ShelfCard({
	directory,
	entry,
}: {
	directory: MarketplaceDirectory;
	entry: MarketplaceEntry;
}) {
	return (
		<div className="flex w-72 shrink-0 snap-start flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-surface-hover-lighter">
			<div className="flex items-start gap-3">
				<EntryGlyph className="size-11 text-base" entry={entry} />
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 items-center gap-1">
						<span className="truncate text-sm font-semibold text-foreground">
							{entry.name}
						</span>
						{entry.verified ? (
							<BadgeCheck className="size-3.5 shrink-0 text-sky-500" />
						) : null}
					</div>
					{entry.author ? (
						<p className="truncate text-xs text-muted-foreground">
							{entry.author.name}
						</p>
					) : null}
				</div>
			</div>
			<p className="line-clamp-2 min-h-8 flex-1 text-xs leading-4 text-muted-foreground">
				{entry.tagline}
			</p>
			<StatusLine directory={directory} entry={entry} />
			<div className="flex items-center justify-between gap-2">
				<InstallButton directory={directory} entry={entry} />
				<LearnMoreLink entry={entry} />
			</div>
		</div>
	);
}

function Shelf({
	directory,
	entries,
	type,
}: {
	directory: MarketplaceDirectory;
	entries: MarketplaceEntry[];
	type: MarketplacePrimitiveType;
}) {
	const meta = TYPE_META[type];
	const Icon = meta.icon;
	if (entries.length === 0) return null;
	return (
		<section className="grid min-w-0 gap-3">
			<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<div className="flex items-center gap-2">
					<Icon className="size-4.5 text-primary" />
					<h2 className="text-lg font-semibold text-foreground">
						{meta.plural}
					</h2>
					<span className="text-sm text-muted-foreground">
						{entries.length}
					</span>
				</div>
				<Badge className="border border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
					{meta.maturity}
				</Badge>
				<p className="text-sm text-muted-foreground">{meta.blurb}</p>
			</div>
			<ScrollArea className="-mx-1 min-w-0">
				<div className="flex snap-x gap-3 px-1 pb-3">
					{entries.map((entry) => (
						<ShelfCard
							directory={directory}
							entry={entry}
							key={entryKey(entry)}
						/>
					))}
				</div>
				<ScrollBar orientation="horizontal" />
			</ScrollArea>
		</section>
	);
}

export function StorefrontMarketplaceView() {
	const directory = useMarketplaceDirectory();
	const [query, setQuery] = useState("");

	const filteredEntries = useMemo(() => {
		const entries = directory.catalog?.entries ?? [];
		const normalized = query.trim().toLowerCase();
		if (normalized.length === 0) return entries;
		return entries.filter((entry) =>
			entrySearchText(entry, directory.tagLabels).includes(normalized),
		);
	}, [directory.catalog?.entries, directory.tagLabels, query]);

	const entriesByType = useMemo(() => {
		const grouped = new Map<MarketplacePrimitiveType, MarketplaceEntry[]>();
		for (const type of MATURITY_ORDER) grouped.set(type, []);
		for (const entry of filteredEntries) {
			grouped.get(entry.type)?.push(entry);
		}
		for (const entries of grouped.values()) {
			entries.sort(
				(a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)),
			);
		}
		return grouped;
	}, [filteredEntries]);

	// Featured spotlight: prefer a featured entry per maturity tier so the
	// hero band spans the catalog rather than a single type.
	const spotlight = useMemo(() => {
		if (query.trim().length > 0) return [];
		const featured = (directory.catalog?.entries ?? []).filter(
			(entry) => entry.featured,
		);
		const picks: MarketplaceEntry[] = [];
		for (const type of MATURITY_ORDER) {
			const pick = featured.find((entry) => entry.type === type);
			if (pick) picks.push(pick);
		}
		for (const entry of featured) {
			if (picks.length >= 4) break;
			if (!picks.includes(entry)) picks.push(entry);
		}
		return picks;
	}, [directory.catalog?.entries, query]);

	return (
		<ScrollArea className="h-full">
			<div className="px-18 py-10 max-[1200px]:px-8 max-[720px]:px-4 max-[720px]:py-5">
				<div className="grid max-w-344 gap-8">
					<section className="flex flex-wrap items-end justify-between gap-4">
						<div>
							<h1 className="text-3xl font-semibold text-foreground">
								Marketplace
							</h1>
							<p className="mt-2 max-w-2xl text-base text-muted-foreground">
								Skills, MCP servers, and plugins from the Cline community —
								ordered by how battle-tested each primitive is.
							</p>
						</div>
						<div className="relative w-full max-w-xs">
							<Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								aria-label="Search marketplace"
								className="h-10 pl-8"
								onChange={(event) => setQuery(event.target.value)}
								placeholder="Search marketplace"
								value={query}
							/>
						</div>
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

					{spotlight.length > 0 ? (
						<section className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
							<HeroCard directory={directory} entry={spotlight[0]} />
							<div className="grid content-start gap-3">
								{spotlight.slice(1, 4).map((entry) => (
									<FeaturedMiniCard
										directory={directory}
										entry={entry}
										key={entryKey(entry)}
									/>
								))}
							</div>
						</section>
					) : null}

					{directory.catalog
						? MATURITY_ORDER.map((type) => (
								<Shelf
									directory={directory}
									entries={entriesByType.get(type) ?? []}
									key={type}
									type={type}
								/>
							))
						: null}

					{directory.catalog && filteredEntries.length === 0 ? (
						<div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
							No marketplace entries match "{query}".
						</div>
					) : null}
				</div>
			</div>
		</ScrollArea>
	);
}
