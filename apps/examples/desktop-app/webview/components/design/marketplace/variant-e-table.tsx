"use client";

import { ArrowDown, ArrowUp, ChevronDown, Filter } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
	allCategories,
	countByKind,
	type ItemKind,
	itemMatches,
	KIND_META,
	KIND_ORDER,
	type MarketplaceItem,
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

type SortKey = "name" | "kind" | "author" | "setup";

/**
 * Variation E: "Directory table". A dense, sortable table for people who
 * want to scan 300 rows quickly: Type and Setup are first-class columns, so
 * "what is this and what will it cost me to add" is readable at a glance
 * without opening anything. Filters are dropdown facets in a toolbar
 * (multi-select types, category, installed only) instead of pill rows.
 */
export function VariantTable({ items }: { items: MarketplaceItem[] }) {
	const [query, setQuery] = useState("");
	const [kinds, setKinds] = useState<Set<ItemKind>>(() => new Set());
	const [category, setCategory] = useState("all");
	const [installedOnly, setInstalledOnly] = useState(false);
	const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
		key: "name",
		dir: 1,
	});
	const [selectedKey, setSelectedKey] = useState<string | null>(null);

	const categories = useMemo(() => allCategories(items), [items]);
	const kindCounts = useMemo(() => countByKind(items), [items]);
	const rows = useMemo(() => {
		const filtered = items.filter(
			(item) =>
				(kinds.size === 0 || kinds.has(item.kind)) &&
				(category === "all" || item.categories.includes(category)) &&
				(!installedOnly || item.installed) &&
				itemMatches(item, query),
		);
		const setupRank = { none: 0, oauth: 1, env: 2 } as const;
		return filtered.sort((a, b) => {
			let result = 0;
			if (sort.key === "name") result = a.name.localeCompare(b.name);
			else if (sort.key === "kind")
				result =
					KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
					a.name.localeCompare(b.name);
			else if (sort.key === "author")
				result =
					(a.author ?? "").localeCompare(b.author ?? "") ||
					a.name.localeCompare(b.name);
			else
				result =
					setupRank[a.setup] - setupRank[b.setup] ||
					a.name.localeCompare(b.name);
			return result * sort.dir;
		});
	}, [items, kinds, category, installedOnly, query, sort]);
	const selected = items.find((item) => item.key === selectedKey) ?? null;

	const toggleSort = (key: SortKey) =>
		setSort((current) =>
			current.key === key
				? { key, dir: current.dir === 1 ? -1 : 1 }
				: { key, dir: 1 },
		);
	const activeFilterCount =
		kinds.size + (category !== "all" ? 1 : 0) + (installedOnly ? 1 : 0);

	return (
		<div className="flex h-full min-h-0">
			<div
				className={cn(
					"flex min-w-0 flex-col",
					selected ? "w-[640px] shrink-0 border-r" : "flex-1",
				)}
			>
				<div className="flex items-center gap-2 border-b px-4 py-3">
					<SearchField
						className="w-72"
						onChange={setQuery}
						placeholder="Search"
						value={query}
					/>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button size="sm" type="button" variant="outline">
								Type
								{kinds.size > 0 ? (
									<span className="rounded bg-foreground/10 px-1 text-[10px]">
										{kinds.size}
									</span>
								) : null}
								<ChevronDown className="size-3.5 text-muted-foreground" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" className="w-56">
							<DropdownMenuLabel>Show types</DropdownMenuLabel>
							{KIND_ORDER.map((kind) => {
								const meta = KIND_META[kind];
								return (
									<DropdownMenuCheckboxItem
										checked={kinds.has(kind)}
										key={kind}
										onCheckedChange={(checked) =>
											setKinds((current) => {
												const next = new Set(current);
												if (checked) next.add(kind);
												else next.delete(kind);
												return next;
											})
										}
									>
										<meta.icon className={cn("size-3.5", meta.text)} />
										{meta.plural}
										<span className="ml-auto text-xs text-muted-foreground">
											{kindCounts.get(kind) ?? 0}
										</span>
									</DropdownMenuCheckboxItem>
								);
							})}
						</DropdownMenuContent>
					</DropdownMenu>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button size="sm" type="button" variant="outline">
								{category === "all" ? "Category" : category}
								<ChevronDown className="size-3.5 text-muted-foreground" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" className="w-56">
							<DropdownMenuRadioGroup
								onValueChange={setCategory}
								value={category}
							>
								<DropdownMenuRadioItem value="all">
									All categories
								</DropdownMenuRadioItem>
								<DropdownMenuSeparator />
								{categories.map((candidate) => (
									<DropdownMenuRadioItem key={candidate} value={candidate}>
										{candidate}
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</DropdownMenuContent>
					</DropdownMenu>
					<Button
						aria-pressed={installedOnly}
						onClick={() => setInstalledOnly((current) => !current)}
						size="sm"
						type="button"
						variant={installedOnly ? "default" : "outline"}
					>
						Installed
					</Button>
					{activeFilterCount > 0 ? (
						<Button
							className="text-muted-foreground"
							onClick={() => {
								setKinds(new Set());
								setCategory("all");
								setInstalledOnly(false);
							}}
							size="sm"
							type="button"
							variant="ghost"
						>
							<Filter className="size-3.5" />
							Clear
						</Button>
					) : null}
					<span className="ml-auto text-xs tabular-nums text-muted-foreground">
						{rows.length} of {items.length}
					</span>
				</div>
				<ScrollArea className="min-h-0 flex-1">
					{rows.length === 0 ? (
						<EmptyState query={query} />
					) : (
						<Table className="text-[13px]">
							<TableHeader className="sticky top-0 z-10 bg-background">
								<TableRow className="hover:bg-transparent">
									<SortableHead
										className="pl-4"
										label="Name"
										onClick={() => toggleSort("name")}
										sort={sort}
										sortKey="name"
									/>
									<SortableHead
										label="Type"
										onClick={() => toggleSort("kind")}
										sort={sort}
										sortKey="kind"
									/>
									{selected ? null : (
										<TableHead className="text-xs font-medium text-muted-foreground">
											Category
										</TableHead>
									)}
									{selected ? null : (
										<SortableHead
											label="Author"
											onClick={() => toggleSort("author")}
											sort={sort}
											sortKey="author"
										/>
									)}
									<SortableHead
										label="Setup"
										onClick={() => toggleSort("setup")}
										sort={sort}
										sortKey="setup"
									/>
									<TableHead className="pr-4" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{rows.map((item) => (
									<TableRow
										className={cn(
											"cursor-pointer",
											item.key === selectedKey &&
												"bg-primary/10 hover:bg-primary/10",
										)}
										key={item.key}
										onClick={() => setSelectedKey(item.key)}
									>
										<TableCell className="max-w-[320px] pl-4">
											<div className="flex min-w-0 items-center gap-2.5">
												<ItemIcon item={item} size="sm" />
												<div className="min-w-0">
													<div className="flex items-center gap-1.5">
														<span className="truncate font-medium text-foreground">
															{item.name}
														</span>
														{item.verified ? <VerifiedMark /> : null}
													</div>
													<p className="truncate text-xs text-muted-foreground">
														{item.tagline}
													</p>
												</div>
											</div>
										</TableCell>
										<TableCell>
											<KindPill kind={item.kind} short />
										</TableCell>
										{selected ? null : (
											<TableCell>
												<div className="flex gap-1">
													{item.categories.slice(0, 2).map((candidate) => (
														<Badge
															className="font-normal text-muted-foreground"
															key={candidate}
															variant="outline"
														>
															{candidate}
														</Badge>
													))}
												</div>
											</TableCell>
										)}
										{selected ? null : (
											<TableCell className="max-w-[140px] truncate text-muted-foreground">
												{item.author ?? "—"}
											</TableCell>
										)}
										<TableCell>
											<SetupHint item={item} />
										</TableCell>
										<TableCell className="pr-4 text-right">
											<InstallButton item={item} />
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</ScrollArea>
			</div>
			{selected ? (
				<DetailPanel item={selected} onClose={() => setSelectedKey(null)} />
			) : null}
		</div>
	);
}

function SortableHead({
	className,
	label,
	onClick,
	sort,
	sortKey,
}: {
	className?: string;
	label: string;
	onClick: () => void;
	sort: { key: SortKey; dir: 1 | -1 };
	sortKey: SortKey;
}) {
	const active = sort.key === sortKey;
	return (
		<TableHead className={cn("text-xs font-medium", className)}>
			<button
				className={cn(
					"inline-flex items-center gap-1",
					active
						? "text-foreground"
						: "text-muted-foreground hover:text-foreground",
				)}
				onClick={onClick}
				type="button"
			>
				{label}
				{active ? (
					sort.dir === 1 ? (
						<ArrowUp className="size-3" />
					) : (
						<ArrowDown className="size-3" />
					)
				) : null}
			</button>
		</TableHead>
	);
}
