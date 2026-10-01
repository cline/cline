"use client";

import { Check, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
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
	ItemIcon,
	KindPill,
	SearchField,
	VerifiedMark,
} from "./shared";

/**
 * Variation A: "Typed rows". Keeps today's master/detail skeleton but makes
 * every row self-describing: an icon tile tinted by kind, a kind pill, and a
 * section header that explains what the kind is. Category tags move out of
 * the pill soup into a single dropdown so only one tier of chips remains.
 */
export function VariantTypedRows({ items }: { items: MarketplaceItem[] }) {
	const [query, setQuery] = useState("");
	const [kind, setKind] = useState<ItemKind | null>(null);
	const [category, setCategory] = useState<string>("all");
	const [selectedKey, setSelectedKey] = useState<string | null>(null);

	const categories = useMemo(() => allCategories(items), [items]);
	const kindCounts = useMemo(() => countByKind(items), [items]);
	const filtered = useMemo(
		() =>
			sortItems(
				items.filter(
					(item) =>
						(!kind || item.kind === kind) &&
						(category === "all" || item.categories.includes(category)) &&
						itemMatches(item, query),
				),
			),
		[items, kind, category, query],
	);
	const groups = KIND_ORDER.map((groupKind) => ({
		kind: groupKind,
		items: filtered.filter((item) => item.kind === groupKind),
	})).filter((group) => group.items.length > 0);
	const selected = items.find((item) => item.key === selectedKey) ?? null;

	return (
		<div className="flex h-full min-h-0 min-w-0">
			<aside
				className={cn(
					"flex min-w-0 flex-col",
					selected ? "w-90 shrink-0 border-r" : "flex-1",
				)}
			>
				<div className="grid gap-2.5 border-b p-3">
					<SearchField onChange={setQuery} value={query} />
					<div className="flex flex-wrap items-center gap-1.5">
						<Button
							aria-pressed={kind === null}
							onClick={() => setKind(null)}
							size="xs"
							type="button"
							variant={kind === null ? "default" : "outline"}
						>
							All
							<span className="text-[10px] opacity-70">{items.length}</span>
						</Button>
						{KIND_ORDER.map((candidate) => {
							const meta = KIND_META[candidate];
							const active = kind === candidate;
							return (
								<Button
									aria-pressed={active}
									key={candidate}
									onClick={() =>
										setKind((current) =>
											current === candidate ? null : candidate,
										)
									}
									size="xs"
									type="button"
									variant={active ? "default" : "outline"}
								>
									<meta.icon className={cn("size-3.5", !active && meta.text)} />
									{meta.plural}
									<span className="text-[10px] opacity-70">
										{kindCounts.get(candidate) ?? 0}
									</span>
								</Button>
							);
						})}
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									className="ml-auto text-muted-foreground"
									size="xs"
									type="button"
									variant="ghost"
								>
									{category === "all" ? "All categories" : category}
									<ChevronDown className="size-3.5" />
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
				</div>
				<ScrollArea className="min-h-0 flex-1">
					<div className="grid gap-5 p-2 pb-6">
						{groups.map((group) => {
							const meta = KIND_META[group.kind];
							return (
								<section className="grid gap-0.5" key={group.kind}>
									<header className="flex items-baseline gap-2 px-2.5 pb-1.5 pt-1">
										<span
											className={cn(
												"flex size-5 shrink-0 translate-y-1 items-center justify-center rounded-md",
												meta.bg,
												meta.text,
											)}
										>
											<meta.icon className="size-3" />
										</span>
										<span className="text-sm font-semibold text-foreground">
											{meta.plural}
										</span>
										<span className="text-xs text-muted-foreground">
											{group.items.length}
										</span>
										<span className="ml-1 hidden min-w-0 truncate text-xs text-muted-foreground/80 md:inline">
											{meta.blurb}
										</span>
									</header>
									{group.items.map((item) => (
										<Row
											item={item}
											key={item.key}
											onSelect={() => setSelectedKey(item.key)}
											selected={item.key === selectedKey}
											showKind={kind === null && query.trim().length > 0}
										/>
									))}
								</section>
							);
						})}
						{groups.length === 0 ? <EmptyState query={query} /> : null}
					</div>
				</ScrollArea>
			</aside>
			{selected ? (
				<DetailPanel item={selected} onClose={() => setSelectedKey(null)} />
			) : null}
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
		<button
			className={cn(
				"flex w-full min-w-0 items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
				selected ? "bg-primary/10" : "hover:bg-surface-hover-lighter",
			)}
			onClick={onSelect}
			type="button"
		>
			<ItemIcon item={item} size="sm" />
			<span className="min-w-0 flex-1">
				<span className="flex min-w-0 items-center gap-1.5">
					<span className="truncate text-sm font-medium text-foreground">
						{item.name}
					</span>
					{item.verified ? <VerifiedMark /> : null}
				</span>
				<span className="block truncate text-xs text-muted-foreground">
					{item.tagline}
				</span>
			</span>
			{showKind ? <KindPill kind={item.kind} short /> : null}
			{item.installed ? (
				<span
					className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400"
					title="Installed"
				>
					<Check className="size-3.5" />
				</span>
			) : null}
		</button>
	);
}
