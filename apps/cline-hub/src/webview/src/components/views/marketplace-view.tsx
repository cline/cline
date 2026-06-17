"use client";

import {
	CheckCircle2,
	Copy,
	ExternalLink,
	Package,
	Plug,
	Search,
	Server,
	Sparkles,
	Wrench,
} from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { desktopClient } from "@/lib/desktop-client";
import {
	fetchMarketplaceCatalog,
	type MarketplaceCatalog,
	type MarketplaceEntry,
	type MarketplacePrimitiveType,
	type MarketplaceTag,
} from "@/lib/marketplace";

type PrimitiveFilter = "installed" | "all" | MarketplacePrimitiveType;
type InstallState =
	| { status: "idle" }
	| { status: "installing" }
	| {
			status: "installed";
			message: string;
			output?: string;
	  }
	| { status: "failed"; message: string };

type MarketplaceInstallResult = {
	status: "installed";
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

const primitiveLabels: Record<PrimitiveFilter, string> = {
	installed: "Installed",
	all: "All",
	mcp: "MCP",
	skill: "Skills",
	plugin: "Plugins",
};

const primitiveBadgeLabels: Record<MarketplacePrimitiveType, string> = {
	mcp: "MCP Server",
	skill: "Skill",
	plugin: "Plugin",
};

const primitiveIcons = {
	installed: CheckCircle2,
	all: Package,
	mcp: Server,
	skill: Wrench,
	plugin: Plug,
} satisfies Record<PrimitiveFilter, typeof Package>;

function getPrimitiveCount(
	catalog: MarketplaceCatalog,
	primitive: PrimitiveFilter,
	installedCount: number,
): number {
	if (primitive === "installed") return installedCount;
	if (primitive === "all") return catalog.counts.total;
	if (primitive === "mcp") return catalog.counts.mcps;
	if (primitive === "skill") return catalog.counts.skills;
	return catalog.counts.plugins;
}

function TypeBadge({ type }: { type: MarketplacePrimitiveType }) {
	const tone = {
		mcp: "border-purple-400/40 bg-purple-500/10 text-purple-700 dark:text-purple-300",
		skill:
			"border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
		plugin: "border-sky-400/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
	}[type];
	return (
		<Badge variant="outline" className={tone}>
			{primitiveBadgeLabels[type]}
		</Badge>
	);
}

function MarketplaceIcon() {
	return (
		<svg
			aria-hidden="true"
			className="size-9 shrink-0 text-primary"
			fill="none"
			viewBox="0 0 48 48"
			xmlns="http://www.w3.org/2000/svg"
		>
			<rect
				height="20"
				rx="4"
				stroke="currentColor"
				strokeLinejoin="round"
				strokeWidth="2.5"
				width="28"
				x="10"
				y="18"
			/>
			<path
				d="M14 26h10v12H14V26Z"
				stroke="currentColor"
				strokeLinejoin="round"
				strokeWidth="2.5"
			/>
			<path
				d="M28 27h6M28 33h6"
				stroke="currentColor"
				strokeLinecap="round"
				strokeWidth="2.5"
			/>
			<path
				d="M9 10h30l3 9H6l3-9Z"
				stroke="currentColor"
				strokeLinejoin="round"
				strokeWidth="2.5"
			/>
			<path
				d="M15 10l-1.5 9M24 10v9M33 10l1.5 9"
				stroke="currentColor"
				strokeLinecap="round"
				strokeWidth="2.5"
			/>
			<path
				d="M6 19h36v2c0 1.7-1.3 3-3 3s-3-1.3-3-3c0 1.7-1.3 3-3 3s-3-1.3-3-3c0 1.7-1.3 3-3 3s-3-1.3-3-3c0 1.7-1.3 3-3 3s-3-1.3-3-3c0 1.7-1.3 3-3 3s-3-1.3-3-3c0 1.7-1.3 3-3 3s-3-1.3-3-3v-2Z"
				stroke="currentColor"
				strokeLinejoin="round"
				strokeWidth="2.5"
			/>
		</svg>
	);
}

function EntryIcon({ entry }: { entry: MarketplaceEntry }) {
	const initials = entry.name
		.split(/\s+/)
		.map((part) => part[0])
		.join("")
		.slice(0, 2)
		.toUpperCase();
	return (
		<div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-background">
			{entry.icon ? (
				<img
					alt=""
					className="max-h-8 max-w-8 object-contain"
					referrerPolicy="no-referrer"
					src={entry.icon}
				/>
			) : (
				<span className="text-xs font-semibold text-muted-foreground">
					{initials}
				</span>
			)}
		</div>
	);
}

function PrimitiveButton({
	active,
	catalog,
	installedCount,
	onClick,
	primitive,
}: {
	active: boolean;
	catalog: MarketplaceCatalog;
	installedCount: number;
	onClick: () => void;
	primitive: PrimitiveFilter;
}) {
	const Icon = primitiveIcons[primitive];
	return (
		<Button
			aria-pressed={active}
			className="w-full justify-between"
			onClick={onClick}
			type="button"
			variant={active ? "default" : "ghost"}
		>
			<span className="flex min-w-0 items-center gap-2">
				<Icon className="size-4" />
				<span className="truncate">{primitiveLabels[primitive]}</span>
			</span>
			<span className="rounded bg-background/30 px-1.5 py-0.5 text-xs">
				{getPrimitiveCount(catalog, primitive, installedCount)}
			</span>
		</Button>
	);
}

function TagButton({
	active,
	onClick,
	tag,
}: {
	active: boolean;
	onClick: () => void;
	tag: MarketplaceTag;
}) {
	return (
		<Button
			aria-pressed={active}
			className="w-full justify-between"
			onClick={onClick}
			size="sm"
			type="button"
			variant={active ? "default" : "ghost"}
		>
			<span className="truncate">{tag.label}</span>
			<span className="rounded bg-background/30 px-1.5 py-0.5 text-xs">
				{tag.count}
			</span>
		</Button>
	);
}

function installLabel(installed: boolean): string {
	if (installed) return "Installed";
	return "Install";
}

function entryKey(entry: Pick<MarketplaceEntry, "id" | "type">): string {
	return `${entry.type}:${entry.id}`;
}

function MarketplaceCard({
	entry,
	installed,
	installedStatusReady,
	onInstall,
	tagLabels,
}: {
	entry: MarketplaceEntry;
	installed: boolean;
	installedStatusReady: boolean;
	onInstall: (entry: MarketplaceEntry) => void;
	tagLabels: Map<string, string>;
}) {
	const openInstallDialog = () => onInstall(entry);
	return (
		// biome-ignore lint/a11y/useSemanticElements: The card contains a nested action button, so the wrapper cannot be a native button.
		<div
			aria-label={`View ${entry.name} installation details`}
			className="flex min-h-64 cursor-pointer flex-col rounded-lg border bg-card p-4 transition-colors hover:bg-accent/20 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
			onClick={openInstallDialog}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					openInstallDialog();
				}
			}}
			role="button"
			tabIndex={0}
		>
			<div className="flex items-start gap-3">
				<EntryIcon entry={entry} />
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 items-start justify-between gap-2">
						<h2 className="min-w-0 truncate text-sm font-semibold text-foreground">
							{entry.name}
							{entry.featured ? (
								<Sparkles className="ml-1.5 inline size-3.5 shrink-0 text-primary" />
							) : null}
						</h2>
						<TypeBadge type={entry.type} />
					</div>
					<div className="mt-1 flex flex-wrap gap-1.5">
						{entry.tags.slice(0, 4).map((tag) => (
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
			</div>
			<p className="mt-3 line-clamp-3 text-xs leading-5 text-muted-foreground">
				{entry.tagline}
			</p>
			{entry.install.env && entry.install.env.length > 0 ? (
				<p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
					Requires setup after install
				</p>
			) : null}
			<div className="mt-auto pt-4">
				<Button
					className="w-full"
					disabled={!installedStatusReady}
					onClick={openInstallDialog}
					type="button"
					variant={installed ? "secondary" : "default"}
				>
					{installedStatusReady ? null : <Spinner />}
					{installedStatusReady && installed ? (
						<CheckCircle2 className="size-4" />
					) : null}
					{installedStatusReady ? installLabel(installed) : "Checking..."}
				</Button>
			</div>
		</div>
	);
}

function InstallDialog({
	entry,
	installed,
	installedStatusReady,
	onClose,
	onInstalled,
	open,
}: {
	entry: MarketplaceEntry | null;
	installed: boolean;
	installedStatusReady: boolean;
	onClose: () => void;
	onInstalled: (entry: MarketplaceEntry) => void;
	open: boolean;
}) {
	const [state, setState] = useState<InstallState>({ status: "idle" });
	const requiredEnv =
		entry?.install.env?.filter((env) => env.required !== false) ?? [];
	const optionalEnv =
		entry?.install.env?.filter((env) => env.required === false) ?? [];

	useEffect(() => {
		if (open) {
			setState({ status: "idle" });
		}
	}, [open]);

	const copyCommand = async () => {
		if (!entry) return;
		await navigator.clipboard?.writeText(entry.install.command);
	};

	const install = async () => {
		if (!entry || state.status === "installing") return;
		setState({ status: "installing" });
		try {
			const result = await desktopClient.invoke<MarketplaceInstallResult>(
				"install_marketplace_entry",
				{ entry },
				{ timeoutMs: INSTALL_TIMEOUT_MS },
			);
			setState({
				status: "installed",
				message: result.message,
				output: result.output,
			});
			onInstalled(entry);
		} catch (error) {
			setState({
				status: "failed",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	};

	if (!entry) return null;
	return (
		<Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<div className="flex items-start gap-3">
						<EntryIcon entry={entry} />
						<div className="min-w-0">
							<DialogTitle>{entry.name}</DialogTitle>
							<DialogDescription className="mt-1">
								{entry.tagline}
							</DialogDescription>
							<div className="mt-2 flex flex-wrap gap-1.5">
								<TypeBadge type={entry.type} />
							</div>
						</div>
					</div>
				</DialogHeader>

				<p className="text-sm leading-6 text-muted-foreground">
					{entry.description}
				</p>

				<div className="rounded-lg border bg-muted/30 p-3">
					<div className="mb-2 flex items-center justify-between gap-3">
						<p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
							Equivalent Command
						</p>
						<Button
							onClick={copyCommand}
							size="sm"
							type="button"
							variant="ghost"
						>
							<Copy className="size-3.5" />
							Copy
						</Button>
					</div>
					<code className="block overflow-x-auto whitespace-nowrap font-mono text-xs text-muted-foreground">
						<span style={CODE_FONT_STYLE}>{entry.install.command}</span>
					</code>
				</div>

				{requiredEnv.length > 0 || optionalEnv.length > 0 ? (
					<div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
						<p className="text-sm font-medium text-amber-800 dark:text-amber-200">
							Environment setup needed
						</p>
						<p className="mt-1 text-xs leading-5 text-amber-800/80 dark:text-amber-100/80">
							This dashboard does not store secrets in v1. Add these values to
							your Cline/plugin environment after install.
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

				{installed && state.status !== "installed" ? (
					<div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
						This entry is already installed.
					</div>
				) : null}
				{!installedStatusReady ? (
					<div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
						Checking whether this entry is already installed...
					</div>
				) : null}
				{state.status === "installed" ? (
					<div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
						{state.message}
					</div>
				) : null}
				{state.status === "failed" ? (
					<div className="max-h-44 overflow-auto rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
						{state.message}
					</div>
				) : null}
				{state.status === "installed" && state.output ? (
					<pre
						className="max-h-44 overflow-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs text-muted-foreground"
						style={CODE_FONT_STYLE}
					>
						{state.output}
					</pre>
				) : null}

				<DialogFooter>
					<Button
						disabled={state.status === "installing"}
						onClick={onClose}
						type="button"
						variant="outline"
					>
						Close
					</Button>
					<Button
						disabled={
							!installedStatusReady ||
							installed ||
							state.status === "installing" ||
							state.status === "installed"
						}
						onClick={install}
						type="button"
					>
						{state.status === "installing" ? <Spinner /> : null}
						{installed || state.status === "installed" ? (
							<CheckCircle2 className="size-4" />
						) : null}
						{!installedStatusReady
							? "Checking..."
							: installed
								? "Installed"
								: state.status === "installing"
									? "Installing..."
									: state.status === "installed"
										? "Installed"
										: installLabel(false)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function MarketplaceView() {
	const [catalog, setCatalog] = useState<MarketplaceCatalog | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [primitive, setPrimitive] = useState<PrimitiveFilter>("all");
	const [selectedTag, setSelectedTag] = useState<string | null>(null);
	const [selectedEntry, setSelectedEntry] = useState<MarketplaceEntry | null>(
		null,
	);
	const [installedEntryKeys, setInstalledEntryKeys] = useState<Set<string>>(
		() => new Set(),
	);
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
				} catch (error) {
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

	const tagLabels = useMemo(
		() => new Map(catalog?.tags.map((tag) => [tag.id, tag.label]) ?? []),
		[catalog?.tags],
	);

	const filteredEntries = useMemo(() => {
		if (!catalog) return [];
		const normalizedQuery = query.trim().toLowerCase();
		return catalog.entries.filter((entry) => {
			const key = entryKey(entry);
			const matchesPrimitive =
				primitive === "all" ||
				(primitive === "installed" && installedEntryKeys.has(key)) ||
				entry.type === primitive;
			const matchesTag = !selectedTag || entry.tags.includes(selectedTag);
			const searchableText = [
				entry.name,
				entry.tagline,
				entry.description,
				entry.type,
				...entry.tags.map((tag) => tagLabels.get(tag) ?? tag),
			]
				.join(" ")
				.toLowerCase();
			const matchesQuery =
				normalizedQuery.length === 0 ||
				searchableText.includes(normalizedQuery);
			return matchesPrimitive && matchesTag && matchesQuery;
		});
	}, [catalog, installedEntryKeys, primitive, query, selectedTag, tagLabels]);

	const clearFilters = () => {
		setQuery("");
		setPrimitive("all");
		setSelectedTag(null);
	};

	const activeFilters =
		query.trim().length > 0 || primitive !== "all" || selectedTag !== null;
	const installedStatusReady = installedStatusState === "ready";
	const selectedEntryInstalled = selectedEntry
		? installedEntryKeys.has(entryKey(selectedEntry))
		: false;

	return (
		<ScrollArea className="h-full">
			<div className="mx-auto max-w-7xl px-6 py-6 max-[720px]:px-3">
				<div className="mb-6 flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
					<div>
						<h1 className="flex items-center gap-3 text-2xl font-semibold tracking-normal text-foreground">
							<MarketplaceIcon />
							<span>Marketplace</span>
						</h1>
						<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
							Browse Cline primitives and install them directly into this CLI
							environment.
						</p>
					</div>
					{catalog?.generatedAt ? (
						<p className="text-xs text-muted-foreground">
							Updated{" "}
							{new Intl.DateTimeFormat(undefined, {
								month: "short",
								day: "numeric",
								year: "numeric",
							}).format(new Date(catalog.generatedAt))}
						</p>
					) : null}
				</div>

				{!catalog && !errorMessage ? (
					<div className="flex min-h-80 items-center justify-center rounded-lg border bg-card text-sm text-muted-foreground">
						<Spinner className="mr-2" />
						Loading marketplace...
					</div>
				) : (
					<div className="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
						<aside className="min-w-0 lg:sticky lg:top-4 lg:self-start">
							<div className="rounded-lg border bg-card p-3">
								<PrimitiveButton
									active={primitive === "installed"}
									catalog={
										catalog ?? {
											version: 1,
											counts: {
												total: 0,
												mcps: 0,
												skills: 0,
												plugins: 0,
											},
											tags: [],
											entries: [],
										}
									}
									installedCount={installedEntryKeys.size}
									onClick={() => setPrimitive("installed")}
									primitive="installed"
								/>
							</div>

							<div className="mt-3 rounded-lg border bg-card p-3">
								<p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
									Primitive
								</p>
								<div className="grid gap-1">
									{(["all", "mcp", "skill", "plugin"] as PrimitiveFilter[]).map(
										(item) => (
											<PrimitiveButton
												active={primitive === item}
												catalog={
													catalog ?? {
														version: 1,
														counts: {
															total: 0,
															mcps: 0,
															skills: 0,
															plugins: 0,
														},
														tags: [],
														entries: [],
													}
												}
												installedCount={installedEntryKeys.size}
												key={item}
												onClick={() => setPrimitive(item)}
												primitive={item}
											/>
										),
									)}
								</div>
							</div>

							<div className="mt-3 rounded-lg border bg-card p-3">
								<div className="mb-2 flex items-center justify-between gap-2">
									<p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
										Tags
									</p>
									{selectedTag ? (
										<Button
											onClick={() => setSelectedTag(null)}
											size="xs"
											type="button"
											variant="ghost"
										>
											Clear
										</Button>
									) : null}
								</div>
								<div className="grid max-h-80 gap-1 overflow-y-auto">
									{catalog?.tags
										.filter((tag) => tag.count > 0)
										.map((tag) => (
											<TagButton
												active={selectedTag === tag.id}
												key={tag.id}
												onClick={() =>
													setSelectedTag((current) =>
														current === tag.id ? null : tag.id,
													)
												}
												tag={tag}
											/>
										))}
									{catalog?.tags.every((tag) => tag.count === 0) ? (
										<p className="px-2 py-3 text-xs text-muted-foreground">
											No tags available.
										</p>
									) : null}
								</div>
							</div>
						</aside>

						<section className="min-w-0">
							<div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
								<div className="relative block flex-1">
									<Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
									<Input
										aria-label="Search marketplace"
										className="h-10 pl-8"
										onChange={(event) => setQuery(event.target.value)}
										placeholder="Search marketplace"
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

							{errorMessage ? (
								<div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
									{errorMessage}
								</div>
							) : null}

							{catalog && filteredEntries.length > 0 ? (
								<div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
									{filteredEntries.map((entry) => {
										const key = entryKey(entry);
										return (
											<MarketplaceCard
												entry={entry}
												installed={installedEntryKeys.has(key)}
												installedStatusReady={installedStatusReady}
												key={key}
												onInstall={setSelectedEntry}
												tagLabels={tagLabels}
											/>
										);
									})}
								</div>
							) : null}

							{catalog && filteredEntries.length === 0 ? (
								<div className="flex min-h-80 flex-col items-center justify-center rounded-lg border border-dashed bg-card p-6 text-center">
									<p className="text-base font-medium text-foreground">
										No entries found
									</p>
									<p className="mt-1 text-sm text-muted-foreground">
										Try changing your search or filters.
									</p>
									{activeFilters ? (
										<Button
											className="mt-4"
											onClick={clearFilters}
											type="button"
											variant="outline"
										>
											Clear filters
										</Button>
									) : null}
								</div>
							) : null}
						</section>
					</div>
				)}
			</div>
			<InstallDialog
				entry={selectedEntry}
				installed={selectedEntryInstalled}
				installedStatusReady={installedStatusReady}
				key={selectedEntry ? entryKey(selectedEntry) : "empty"}
				onClose={() => setSelectedEntry(null)}
				onInstalled={(entry) =>
					setInstalledEntryKeys((current) =>
						new Set(current).add(entryKey(entry)),
					)
				}
				open={selectedEntry !== null}
			/>
		</ScrollArea>
	);
}
