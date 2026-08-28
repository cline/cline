import {
	ArrowUpRight,
	BadgeCheck,
	Github,
	Globe,
	Scale,
	Search,
	Trash2,
	User,
} from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { openExternalUrl } from "@/lib/desktop-client";
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
	MATURITY_ORDER,
	type MarketplaceDirectory,
	TYPE_META,
	useMarketplaceDirectory,
} from "./shared";

/**
 * Direction B: "Explorer" — a two-pane master/detail marketplace in the
 * spirit of an IDE extensions panel. The left rail lists everything grouped
 * by maturity (Skills, then MCP, then plugins); the right pane is a full
 * detail page for the selected entry with every piece of catalog metadata.
 */

const CODE_FONT_STYLE: CSSProperties = {
	fontFamily:
		'"Geist Mono Variable", ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
};

type TypeFilter = MarketplacePrimitiveType | null;

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
			<EntryGlyph className="size-9 text-sm" entry={entry} />
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
}: {
	directory: MarketplaceDirectory;
	entry: MarketplaceEntry;
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
					<EntryGlyph
						className="size-20 text-3xl"
						entry={entry}
						rounded="rounded-2xl"
					/>
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
								<Badge
									className="text-muted-foreground"
									key={tag}
									variant="outline"
								>
									{directory.tagLabels.get(tag) ?? tag}
								</Badge>
							))}
						</div>
					) : null}
				</section>

				<section className="grid gap-2">
					<h2 className="text-sm font-semibold text-foreground">
						Install via CLI
					</h2>
					<pre
						className="overflow-x-auto rounded-lg border bg-muted/40 p-3 text-xs text-foreground"
						style={CODE_FONT_STYLE}
					>
						{entry.install.command}
					</pre>
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

export function ExplorerMarketplaceView() {
	const directory = useMarketplaceDirectory();
	const [query, setQuery] = useState("");
	const [typeFilter, setTypeFilter] = useState<TypeFilter>(null);
	const [selectedKey, setSelectedKey] = useState<string | null>(null);

	const filteredEntries = useMemo(() => {
		const entries = directory.catalog?.entries ?? [];
		const normalized = query.trim().toLowerCase();
		return entries.filter(
			(entry) =>
				(!typeFilter || entry.type === typeFilter) &&
				(normalized.length === 0 ||
					entrySearchText(entry, directory.tagLabels).includes(normalized)),
		);
	}, [directory.catalog?.entries, directory.tagLabels, query, typeFilter]);

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
										<Badge className="ml-auto border border-emerald-500/20 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300">
											{meta.maturity}
										</Badge>
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
				<DetailPane directory={directory} entry={selectedEntry} />
			) : (
				<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
					Select an entry to see details.
				</div>
			)}
		</div>
	);
}
