"use client";

import { ArrowRight, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
	allCategories,
	countByKind,
	type ItemKind,
	itemMatches,
	KIND_META,
	KIND_ORDER,
	type MarketplaceItem,
	sortItems,
} from "./data";
import {
	DetailPanel,
	EmptyState,
	InstallButton,
	ItemIcon,
	KindPill,
	SearchField,
	SetupHint,
	VerifiedMark,
} from "./shared";

type Tab = "all" | ItemKind;

/**
 * Variation C: "Tabs, like Customize". Mirrors the Customize page: one
 * underline tab per kind with a live count, so the kind is never ambiguous
 * because you are always inside one. "All" is an overview with an explainer
 * card per kind plus cross-kind search. Rows are full-width with the
 * category, setup cost, and install action inline; details open beside.
 */
export function VariantTabs({ items }: { items: MarketplaceItem[] }) {
	const [tab, setTab] = useState<Tab>("all");
	const [query, setQuery] = useState("");
	const [category, setCategory] = useState("all");
	const [selectedKey, setSelectedKey] = useState<string | null>(null);

	const kindCounts = useMemo(() => countByKind(items), [items]);
	const categories = useMemo(() => allCategories(items), [items]);
	const filtered = useMemo(
		() =>
			sortItems(
				items.filter(
					(item) =>
						(tab === "all" || item.kind === tab) &&
						(category === "all" || item.categories.includes(category)) &&
						itemMatches(item, query),
				),
			),
		[items, tab, category, query],
	);
	const selected = items.find((item) => item.key === selectedKey) ?? null;
	const searching = query.trim().length > 0 || category !== "all";
	// Inside a kind tab, a search that also hits other kinds (Figma the MCP
	// server vs Figma the connector) gets a one-line pointer to those tabs.
	const elsewhere = useMemo(() => {
		if (tab === "all" || !searching) return [];
		return KIND_ORDER.filter((candidate) => candidate !== tab)
			.map((candidate) => ({
				kind: candidate,
				count: items.filter(
					(item) =>
						item.kind === candidate &&
						(category === "all" || item.categories.includes(category)) &&
						itemMatches(item, query),
				).length,
			}))
			.filter((entry) => entry.count > 0);
	}, [items, tab, category, query, searching]);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="shrink-0 border-b px-8 pt-7">
				<h1 className="text-2xl font-semibold text-foreground">Marketplace</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Skills, MCP servers, plugins, and connectors from Cline and the
					community.
				</p>
				<div className="mt-5 flex items-center gap-0">
					<TabButton
						active={tab === "all"}
						count={items.length}
						label="All"
						onClick={() => setTab("all")}
					/>
					{KIND_ORDER.map((candidate) => (
						<TabButton
							active={tab === candidate}
							beta={candidate === "connector"}
							count={kindCounts.get(candidate) ?? 0}
							key={candidate}
							kind={candidate}
							label={KIND_META[candidate].plural}
							onClick={() => setTab(candidate)}
						/>
					))}
				</div>
			</div>
			<div className="flex min-h-0 flex-1">
				<div
					className={cn(
						"flex min-w-0 flex-col",
						selected ? "w-[520px] shrink-0 border-r" : "flex-1",
					)}
				>
					<div className="flex items-center gap-2 border-b px-8 py-3">
						<SearchField
							className="max-w-md flex-1"
							onChange={setQuery}
							placeholder={
								tab === "all"
									? "Search everything"
									: `Search ${KIND_META[tab].plural.toLowerCase()}`
							}
							value={query}
						/>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									className="ml-auto"
									size="sm"
									type="button"
									variant="outline"
								>
									{category === "all" ? "Category" : category}
									<ChevronDown className="size-3.5 text-muted-foreground" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="w-56">
								<DropdownMenuRadioGroup
									onValueChange={setCategory}
									value={category}
								>
									<DropdownMenuRadioItem value="all">
										All categories
									</DropdownMenuRadioItem>
									{categories.map((candidate) => (
										<DropdownMenuRadioItem key={candidate} value={candidate}>
											{candidate}
										</DropdownMenuRadioItem>
									))}
								</DropdownMenuRadioGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
					<ScrollArea className="min-h-0 flex-1">
						<div className="px-8 py-5">
							{tab === "all" && !searching ? (
								<Overview
									items={items}
									kindCounts={kindCounts}
									onBrowse={setTab}
									onOpen={setSelectedKey}
									selectedKey={selectedKey}
								/>
							) : (
								<div className="grid gap-3">
									{filtered.length === 0 ? (
										<EmptyState query={query} />
									) : (
										<div className="divide-y divide-border/70 rounded-xl border">
											{filtered.map((item) => (
												<Row
													item={item}
													key={item.key}
													onSelect={() => setSelectedKey(item.key)}
													selected={item.key === selectedKey}
													showKind={tab === "all"}
												/>
											))}
										</div>
									)}
									{elsewhere.length > 0 ? (
										<p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs text-muted-foreground">
											Also matching:
											{elsewhere.map((entry) => {
												const meta = KIND_META[entry.kind];
												return (
													<button
														className={cn(
															"inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium transition-colors hover:brightness-110",
															meta.bg,
															meta.text,
														)}
														key={entry.kind}
														onClick={() => setTab(entry.kind)}
														type="button"
													>
														<meta.icon className="size-3" />
														{entry.count}{" "}
														{entry.count === 1 ? meta.label : meta.plural}
														<ArrowRight className="size-3" />
													</button>
												);
											})}
										</p>
									) : null}
								</div>
							)}
						</div>
					</ScrollArea>
				</div>
				{selected ? (
					<DetailPanel item={selected} onClose={() => setSelectedKey(null)} />
				) : null}
			</div>
		</div>
	);
}

function TabButton({
	active,
	beta,
	count,
	kind,
	label,
	onClick,
}: {
	active: boolean;
	beta?: boolean;
	count: number;
	kind?: ItemKind;
	label: string;
	onClick: () => void;
}) {
	const meta = kind ? KIND_META[kind] : null;
	return (
		<button
			aria-current={active ? "page" : undefined}
			className={cn(
				"relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors",
				active
					? "text-foreground"
					: "text-muted-foreground hover:text-foreground",
			)}
			onClick={onClick}
			type="button"
		>
			{meta ? <meta.icon className={cn("size-3.5", meta.text)} /> : null}
			{label}
			{beta ? <Badge className="h-4 px-1 text-[10px]">Beta</Badge> : null}
			<span className="text-xs tabular-nums text-muted-foreground/70">
				{count}
			</span>
			{active ? (
				<span className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground" />
			) : null}
		</button>
	);
}

function Overview({
	items,
	kindCounts,
	onBrowse,
	onOpen,
	selectedKey,
}: {
	items: MarketplaceItem[];
	kindCounts: Map<ItemKind, number>;
	onBrowse: (kind: ItemKind) => void;
	onOpen: (key: string) => void;
	selectedKey: string | null;
}) {
	// Two per kind so the overview shows the range, not just featured plugins.
	const popular = KIND_ORDER.flatMap((kind) =>
		sortItems(
			items.filter(
				(item) => item.kind === kind && (item.featured || item.verified),
			),
		).slice(0, 2),
	);
	return (
		<div className="grid gap-7">
			<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				{KIND_ORDER.map((kind) => {
					const meta = KIND_META[kind];
					return (
						<button
							className="group grid gap-2 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-surface-hover-lighter"
							key={kind}
							onClick={() => onBrowse(kind)}
							type="button"
						>
							<span
								className={cn(
									"flex size-8 items-center justify-center rounded-lg",
									meta.bg,
									meta.text,
								)}
							>
								<meta.icon className="size-4" />
							</span>
							<span className="flex items-baseline gap-1.5">
								<span className="text-sm font-semibold text-foreground">
									{meta.plural}
								</span>
								<span className="text-xs text-muted-foreground">
									{kindCounts.get(kind) ?? 0}
								</span>
							</span>
							<span className="text-xs leading-5 text-muted-foreground">
								{meta.blurb}
							</span>
							<span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-foreground/70 group-hover:text-foreground">
								Browse
								<ArrowRight className="size-3" />
							</span>
						</button>
					);
				})}
			</div>
			<section className="grid gap-3">
				<h2 className="text-sm font-semibold text-foreground">Popular</h2>
				<div className="divide-y divide-border/70 rounded-xl border">
					{popular.map((item) => (
						<Row
							item={item}
							key={item.key}
							onSelect={() => onOpen(item.key)}
							selected={item.key === selectedKey}
							showKind
						/>
					))}
				</div>
			</section>
		</div>
	);
}

function Row({
	item,
	onSelect,
	selected,
	showKind,
}: {
	item: MarketplaceItem;
	onSelect: () => void;
	selected: boolean;
	showKind: boolean;
}) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: contains a nested install button
		<div
			className={cn(
				"flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors first:rounded-t-xl last:rounded-b-xl",
				selected ? "bg-primary/10" : "hover:bg-surface-hover-lighter",
			)}
			onClick={onSelect}
			onKeyDown={(event) => {
				if (event.target !== event.currentTarget) return;
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onSelect();
				}
			}}
			role="button"
			tabIndex={0}
		>
			<ItemIcon item={item} />
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-center gap-1.5">
					<span className="truncate text-sm font-medium text-foreground">
						{item.name}
					</span>
					{item.verified ? <VerifiedMark /> : null}
					{showKind ? <KindPill kind={item.kind} short /> : null}
					{item.author ? (
						<span className="truncate text-xs text-muted-foreground">
							· {item.author}
						</span>
					) : null}
				</div>
				<p className="truncate text-xs text-muted-foreground">{item.tagline}</p>
			</div>
			<div className="hidden shrink-0 items-center gap-1.5 lg:flex">
				{item.categories.slice(0, 2).map((category) => (
					<Badge
						className="text-muted-foreground"
						key={category}
						variant="outline"
					>
						{category}
					</Badge>
				))}
			</div>
			<div className="hidden w-32 shrink-0 justify-end xl:flex">
				<SetupHint item={item} />
			</div>
			<InstallButton item={item} />
		</div>
	);
}
