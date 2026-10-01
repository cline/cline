"use client";

import { Check, Layers } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
	type ItemKind,
	itemMatches,
	KIND_META,
	KIND_ORDER,
	type MarketplaceItem,
	serviceKey,
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
 * Variation D: "One row per service". Entries that are the same product
 * offered through different primitives (Figma the MCP server and Figma the
 * connector; three Cloudflare MCP servers) collapse into one row. The row
 * says what the service is and which ways you can add it; the detail panel
 * turns into an "Add via" chooser that compares the options on setup cost.
 */

type Service = {
	key: string;
	name: string;
	tagline: string;
	icon?: string;
	verified: boolean;
	installed: boolean;
	items: MarketplaceItem[];
	categories: string[];
};

function groupServices(items: MarketplaceItem[]): Service[] {
	const groups = new Map<string, MarketplaceItem[]>();
	for (const item of items) {
		const key = serviceKey(item.name) || item.key;
		groups.set(key, [...(groups.get(key) ?? []), item]);
	}
	return [...groups.entries()].map(([key, members]) => {
		const ordered = [...members].sort(
			(a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
		);
		// A brand logo (connector or catalog icon) beats a kind glyph.
		const withIcon = ordered.find((item) => item.icon);
		const lead =
			ordered.find((item) => item.kind === "connector") ?? ordered[0];
		return {
			key,
			name: lead.name,
			tagline: lead.tagline,
			icon: withIcon?.icon,
			verified: ordered.some((item) => item.verified),
			installed: ordered.some((item) => item.installed),
			items: ordered,
			categories: [...new Set(ordered.flatMap((item) => item.categories))],
		};
	});
}

export function VariantUnified({ items }: { items: MarketplaceItem[] }) {
	const [query, setQuery] = useState("");
	const [kind, setKind] = useState<ItemKind | null>(null);
	const [selectedKey, setSelectedKey] = useState<string | null>(null);

	const services = useMemo(() => {
		const grouped = groupServices(items);
		return grouped.sort(
			(a, b) =>
				Number(b.items.length > 1) - Number(a.items.length > 1) ||
				Number(b.verified) - Number(a.verified) ||
				a.name.localeCompare(b.name),
		);
	}, [items]);
	const filtered = useMemo(
		() =>
			services.filter(
				(service) =>
					(!kind || service.items.some((item) => item.kind === kind)) &&
					service.items.some((item) => itemMatches(item, query)),
			),
		[services, kind, query],
	);
	const mergedCount = services.filter((s) => s.items.length > 1).length;
	const selected = services.find((s) => s.key === selectedKey) ?? null;

	return (
		<div className="flex h-full min-h-0">
			<div
				className={cn(
					"flex min-w-0 flex-col",
					selected ? "w-[560px] shrink-0 border-r" : "flex-1",
				)}
			>
				<div className="grid gap-3 border-b px-6 py-4">
					<div className="flex items-center gap-3">
						<SearchField
							className="max-w-lg flex-1"
							onChange={setQuery}
							placeholder="Search services"
							value={query}
						/>
						<span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
							<Layers className="size-3.5" />
							{services.length} services · {mergedCount} offered multiple ways
						</span>
					</div>
					<div className="flex flex-wrap items-center gap-1.5">
						<span className="mr-1 text-xs text-muted-foreground">
							Available as
						</span>
						{KIND_ORDER.map((candidate) => {
							const meta = KIND_META[candidate];
							const active = kind === candidate;
							return (
								<button
									aria-pressed={active}
									className={cn(
										"inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset transition-colors",
										active
											? cn(meta.bg, meta.text, meta.ring)
											: "text-muted-foreground ring-border hover:text-foreground",
									)}
									key={candidate}
									onClick={() =>
										setKind((current) =>
											current === candidate ? null : candidate,
										)
									}
									type="button"
								>
									<meta.icon className="size-3" />
									{meta.label}
								</button>
							);
						})}
					</div>
				</div>
				<ScrollArea className="min-h-0 flex-1">
					<div className="grid gap-1 p-3">
						{filtered.map((service) => (
							<ServiceRow
								key={service.key}
								onSelect={() => setSelectedKey(service.key)}
								selected={service.key === selectedKey}
								service={service}
							/>
						))}
						{filtered.length === 0 ? <EmptyState query={query} /> : null}
					</div>
				</ScrollArea>
			</div>
			{selected ? (
				selected.items.length === 1 ? (
					<DetailPanel
						item={selected.items[0]}
						onClose={() => setSelectedKey(null)}
					/>
				) : (
					<ServiceDetail
						onClose={() => setSelectedKey(null)}
						service={selected}
					/>
				)
			) : null}
		</div>
	);
}

function ServiceRow({
	service,
	onSelect,
	selected,
}: {
	service: Service;
	onSelect: () => void;
	selected: boolean;
}) {
	const lead = service.items[0];
	const kindCounts = new Map<ItemKind, number>();
	for (const item of service.items) {
		kindCounts.set(item.kind, (kindCounts.get(item.kind) ?? 0) + 1);
	}
	return (
		// biome-ignore lint/a11y/useSemanticElements: contains a nested install button
		<div
			className={cn(
				"flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
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
			<ItemIcon item={{ ...lead, icon: service.icon }} />
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-center gap-1.5">
					<span className="truncate text-sm font-medium text-foreground">
						{service.name}
					</span>
					{service.verified ? <VerifiedMark /> : null}
					{service.installed ? (
						<Check className="size-3.5 text-emerald-500" />
					) : null}
				</div>
				<p className="truncate text-xs text-muted-foreground">
					{service.tagline}
				</p>
			</div>
			<div className="flex shrink-0 items-center gap-1">
				{[...kindCounts.entries()].map(([itemKind, count]) => (
					<KindPill
						className={cn(count > 1 && "pr-1")}
						key={itemKind}
						kind={itemKind}
						short
					/>
				))}
				{service.items.length > 1 ? (
					<span className="ml-1 text-[11px] text-muted-foreground">
						{service.items.length} ways
					</span>
				) : null}
			</div>
			{service.items.length === 1 ? (
				<InstallButton item={lead} />
			) : (
				<Button
					onClick={(event) => {
						event.stopPropagation();
						onSelect();
					}}
					size="xs"
					type="button"
					variant="outline"
				>
					Choose
				</Button>
			)}
		</div>
	);
}

function ServiceDetail({
	service,
	onClose,
}: {
	service: Service;
	onClose: () => void;
}) {
	const lead = service.items[0];
	return (
		<DetailPanel
			item={{
				...lead,
				name: service.name,
				tagline: service.tagline,
				icon: service.icon,
				verified: service.verified,
				categories: service.categories,
				author: undefined,
				toolsCount: undefined,
			}}
			headerExtra={
				<span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
					<Layers className="size-3" />
					{service.items.length} ways to add
				</span>
			}
			hideKind
			onClose={onClose}
		>
			<section className="grid gap-2">
				<h2 className="text-sm font-semibold text-foreground">
					Add {service.name} via
				</h2>
				<p className="text-xs text-muted-foreground">
					{service.name} is available {service.items.length} ways. Pick the one
					that fits how you want it to run.
				</p>
				<div className="grid gap-2">
					{sortItems(service.items).map((item) => {
						const meta = KIND_META[item.kind];
						return (
							<div
								className="flex items-start gap-3 rounded-lg border bg-card p-3"
								key={item.key}
							>
								<span
									className={cn(
										"mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md",
										meta.bg,
										meta.text,
									)}
								>
									<meta.icon className="size-3.5" />
								</span>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<span className="text-sm font-medium text-foreground">
											{meta.label}
										</span>
										{item.name !== service.name ? (
											<span className="truncate text-xs text-muted-foreground">
												{item.name}
											</span>
										) : null}
									</div>
									<p className="mt-0.5 text-xs leading-5 text-muted-foreground">
										{meta.blurb}
									</p>
									<div className="mt-1.5 flex items-center gap-3">
										<SetupHint item={item} />
										{typeof item.toolsCount === "number" ? (
											<span className="text-xs text-muted-foreground">
												{item.toolsCount} tools
											</span>
										) : null}
										{item.author ? (
											<span className="text-xs text-muted-foreground">
												by {item.author}
											</span>
										) : null}
									</div>
								</div>
								<InstallButton item={item} stopPropagation={false} />
							</div>
						);
					})}
				</div>
			</section>
		</DetailPanel>
	);
}
