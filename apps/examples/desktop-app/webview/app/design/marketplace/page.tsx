"use client";

import { useEffect, useState } from "react";
import {
	loadMarketplaceItems,
	type MarketplaceItem,
} from "@/components/design/marketplace/data";
import { VariantTypedRows } from "@/components/design/marketplace/variant-a-typed-rows";
import { VariantStorefront } from "@/components/design/marketplace/variant-b-storefront";
import { VariantTabs } from "@/components/design/marketplace/variant-c-tabs";
import { VariantUnified } from "@/components/design/marketplace/variant-d-unified";
import { VariantTable } from "@/components/design/marketplace/variant-e-table";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * Design exploration for the Marketplace page. Not linked from the app:
 * open http://localhost:3125/design/marketplace while `bun run dev:web` is
 * running. Each variation renders the same unified item list (real catalog
 * plus a connector fixture). Delete this route once a direction is chosen.
 */

const VARIANTS = [
	{
		id: "a",
		name: "Typed rows",
		summary:
			"Today's master/detail list, but every row carries a tinted icon and kind pill; section headers explain each kind; categories move to one dropdown.",
		component: VariantTypedRows,
	},
	{
		id: "b",
		name: "Storefront",
		summary:
			"App-store browse page: hero search, kind departments, a featured strip, and a card grid per kind with inline install. Details open in a side sheet.",
		component: VariantStorefront,
	},
	{
		id: "c",
		name: "Tabs like Customize",
		summary:
			"One underline tab per kind with counts (mirrors the Customize page). All tab is an overview with an explainer card per kind. Full-width rows with setup cost and install inline.",
		component: VariantTabs,
	},
	{
		id: "d",
		name: "One row per service",
		summary:
			"Figma the MCP server and Figma the connector become one Figma row that lists the ways to add it; the detail panel compares them on setup cost. Kills the duplicate feel.",
		component: VariantUnified,
	},
	{
		id: "e",
		name: "Directory table",
		summary:
			"Dense sortable table with Type and Setup as columns and dropdown facets in a toolbar. Built for scanning 300 rows fast.",
		component: VariantTable,
	},
] as const;

type VariantId = (typeof VARIANTS)[number]["id"];

function readHash(): VariantId {
	const hash = window.location.hash.replace("#", "");
	return VARIANTS.some((variant) => variant.id === hash)
		? (hash as VariantId)
		: "a";
}

export default function MarketplaceDesignPage() {
	const [items, setItems] = useState<MarketplaceItem[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [active, setActive] = useState<VariantId>("a");

	useEffect(() => {
		setActive(readHash());
		const onHashChange = () => setActive(readHash());
		window.addEventListener("hashchange", onHashChange);
		return () => window.removeEventListener("hashchange", onHashChange);
	}, []);

	useEffect(() => {
		let cancelled = false;
		loadMarketplaceItems()
			.then((loaded) => {
				if (!cancelled) setItems(loaded);
			})
			.catch((caught) => {
				if (!cancelled)
					setError(caught instanceof Error ? caught.message : String(caught));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const variant =
		VARIANTS.find((candidate) => candidate.id === active) ?? VARIANTS[0];
	const Variant = variant.component;

	return (
		<div className="flex h-screen flex-col bg-background text-foreground">
			<div className="flex shrink-0 items-center gap-3 border-b bg-muted/30 px-4 py-2">
				<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					Marketplace design preview
				</span>
				<div className="flex items-center gap-1 rounded-lg border bg-background p-0.5">
					{VARIANTS.map((candidate) => (
						<a
							className={cn(
								"whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
								candidate.id === active
									? "bg-foreground text-background"
									: "text-muted-foreground hover:text-foreground",
							)}
							href={`#${candidate.id}`}
							key={candidate.id}
						>
							{candidate.id.toUpperCase()}
							<span className="ml-1.5 hidden font-normal lg:inline">
								{candidate.name}
							</span>
						</a>
					))}
				</div>
				<p className="min-w-0 truncate text-xs text-muted-foreground">
					{variant.summary}
				</p>
			</div>
			<div className="min-h-0 flex-1" key={variant.id}>
				{error ? (
					<p className="p-6 text-sm text-destructive">{error}</p>
				) : items ? (
					<Variant items={items} />
				) : (
					<p className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
						<Spinner />
						Loading catalog…
					</p>
				)}
			</div>
		</div>
	);
}
