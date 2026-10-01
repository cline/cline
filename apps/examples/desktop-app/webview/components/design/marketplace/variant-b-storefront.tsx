"use client";

import { ArrowRight, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
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

/**
 * Variation B: "Storefront". An app-store style browse page: a hero search,
 * kind "departments" with counts, a featured strip, and one card grid per
 * kind with "See all". Cards carry the kind pill, setup cost, and an inline
 * install button so most decisions happen without opening details; details
 * open in a side sheet.
 */
export function VariantStorefront({ items }: { items: MarketplaceItem[] }) {
	const [query, setQuery] = useState("");
	const [kind, setKind] = useState<ItemKind | null>(null);
	const [selectedKey, setSelectedKey] = useState<string | null>(null);

	const kindCounts = useMemo(() => countByKind(items), [items]);
	const filtered = useMemo(
		() =>
			sortItems(
				items.filter(
					(item) => (!kind || item.kind === kind) && itemMatches(item, query),
				),
			),
		[items, kind, query],
	);
	const browsing = !kind && query.trim().length === 0;
	const featured = useMemo(
		() =>
			sortItems(items.filter((item) => item.featured || item.installed)).slice(
				0,
				4,
			),
		[items],
	);
	const selected = items.find((item) => item.key === selectedKey) ?? null;

	return (
		<ScrollArea className="h-full">
			<div className="mx-auto grid max-w-6xl gap-8 px-8 py-8">
				<header className="grid gap-4">
					<div>
						<h1 className="text-2xl font-semibold text-foreground">
							Marketplace
						</h1>
						<p className="mt-1 text-sm text-muted-foreground">
							Add skills, tools, and integrations to Cline.
						</p>
					</div>
					<SearchField
						className="max-w-xl"
						inputClassName="h-10"
						onChange={setQuery}
						value={query}
					/>
					<div className="flex flex-wrap gap-2">
						<DepartmentChip
							active={kind === null}
							count={items.length}
							label="Everything"
							onClick={() => setKind(null)}
						/>
						{KIND_ORDER.map((candidate) => (
							<DepartmentChip
								active={kind === candidate}
								count={kindCounts.get(candidate) ?? 0}
								kind={candidate}
								key={candidate}
								label={KIND_META[candidate].plural}
								onClick={() =>
									setKind((current) =>
										current === candidate ? null : candidate,
									)
								}
							/>
						))}
					</div>
				</header>

				{browsing ? (
					<>
						<section className="grid gap-3">
							<SectionTitle
								icon={<Star className="size-4 fill-current text-amber-400" />}
								subtitle="Hand-picked and popular right now"
								title="Featured"
							/>
							<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
								{featured.map((item) => (
									<Card
										item={item}
										key={item.key}
										large
										onOpen={() => setSelectedKey(item.key)}
									/>
								))}
							</div>
						</section>
						{KIND_ORDER.map((groupKind) => {
							const meta = KIND_META[groupKind];
							const groupItems = sortItems(
								items.filter((item) => item.kind === groupKind),
							);
							return (
								<section className="grid gap-3" key={groupKind}>
									<SectionTitle
										action={
											<Button
												className="text-muted-foreground"
												onClick={() => setKind(groupKind)}
												size="xs"
												type="button"
												variant="ghost"
											>
												See all {groupItems.length}
												<ArrowRight className="size-3.5" />
											</Button>
										}
										icon={
											<span
												className={cn(
													"flex size-6 items-center justify-center rounded-md",
													meta.bg,
													meta.text,
												)}
											>
												<meta.icon className="size-3.5" />
											</span>
										}
										subtitle={meta.blurb}
										title={meta.plural}
									/>
									<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
										{groupItems.slice(0, 6).map((item) => (
											<Card
												item={item}
												key={item.key}
												onOpen={() => setSelectedKey(item.key)}
											/>
										))}
									</div>
								</section>
							);
						})}
					</>
				) : (
					<section className="grid gap-3">
						<SectionTitle
							subtitle={
								kind
									? KIND_META[kind].blurb
									: `${filtered.length} results across every kind`
							}
							title={
								kind ? KIND_META[kind].plural : `Results for "${query.trim()}"`
							}
						/>
						{filtered.length === 0 ? (
							<EmptyState query={query} />
						) : (
							<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
								{filtered.map((item) => (
									<Card
										item={item}
										key={item.key}
										onOpen={() => setSelectedKey(item.key)}
										showKind={!kind}
									/>
								))}
							</div>
						)}
					</section>
				)}
			</div>

			<Sheet
				onOpenChange={(open) => !open && setSelectedKey(null)}
				open={selected !== null}
			>
				<SheetContent className="w-[520px] p-0 sm:max-w-[520px]">
					{selected ? (
						<>
							<SheetTitle className="sr-only">{selected.name}</SheetTitle>
							<DetailPanel
								hideClose
								item={selected}
								onClose={() => setSelectedKey(null)}
							/>
						</>
					) : null}
				</SheetContent>
			</Sheet>
		</ScrollArea>
	);
}

function DepartmentChip({
	active,
	count,
	kind,
	label,
	onClick,
}: {
	active: boolean;
	count: number;
	kind?: ItemKind;
	label: string;
	onClick: () => void;
}) {
	const meta = kind ? KIND_META[kind] : null;
	return (
		<button
			aria-pressed={active}
			className={cn(
				"inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
				active
					? "border-foreground bg-foreground text-background"
					: "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
			)}
			onClick={onClick}
			type="button"
		>
			{meta ? (
				<meta.icon className={cn("size-3.5", !active && meta.text)} />
			) : null}
			{label}
			<span className="text-xs opacity-60">{count}</span>
		</button>
	);
}

function SectionTitle({
	action,
	icon,
	subtitle,
	title,
}: {
	action?: React.ReactNode;
	icon?: React.ReactNode;
	subtitle?: string;
	title: string;
}) {
	return (
		<div className="flex items-end justify-between gap-4">
			<div className="flex items-center gap-2.5">
				{icon}
				<div>
					<h2 className="text-base font-semibold text-foreground">{title}</h2>
					{subtitle ? (
						<p className="text-xs text-muted-foreground">{subtitle}</p>
					) : null}
				</div>
			</div>
			{action}
		</div>
	);
}

function Card({
	item,
	large = false,
	onOpen,
	showKind = true,
}: {
	item: MarketplaceItem;
	large?: boolean;
	onOpen: () => void;
	showKind?: boolean;
}) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: contains a nested install button
		<div
			className={cn(
				"group flex min-w-0 cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-surface-hover-lighter",
				large && "min-h-44",
			)}
			onClick={onOpen}
			onKeyDown={(event) => {
				if (event.target !== event.currentTarget) return;
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onOpen();
				}
			}}
			role="button"
			tabIndex={0}
		>
			<div className="flex items-start gap-3">
				<ItemIcon item={item} size={large ? "lg" : "md"} />
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 items-center gap-1.5">
						<span className="truncate text-sm font-semibold text-foreground">
							{item.name}
						</span>
						{item.verified ? <VerifiedMark /> : null}
					</div>
					<div className="mt-0.5 flex items-center gap-2">
						{showKind ? <KindPill kind={item.kind} short /> : null}
						{item.author ? (
							<span className="truncate text-[11px] text-muted-foreground">
								{item.author}
							</span>
						) : null}
					</div>
				</div>
			</div>
			<p
				className={cn(
					"text-xs leading-5 text-muted-foreground",
					large ? "line-clamp-3" : "line-clamp-2",
				)}
			>
				{item.tagline}
			</p>
			<div className="mt-auto flex items-center justify-between gap-2">
				<SetupHint item={item} />
				<InstallButton item={item} />
			</div>
		</div>
	);
}
