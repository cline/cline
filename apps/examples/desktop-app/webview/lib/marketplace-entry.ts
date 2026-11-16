import type { MarketplaceEntry } from "./marketplace";

export function marketplaceEntryKey(
	entry: Pick<MarketplaceEntry, "id" | "type">,
): string {
	return `${entry.type}:${entry.id}`;
}

/** Keep Browse and installed searches consistent, including author metadata. */
export function marketplaceEntrySearchText(
	entry: MarketplaceEntry,
	tagLabels: ReadonlyMap<string, string>,
): string {
	return [
		entry.name,
		entry.tagline,
		entry.description,
		entry.type,
		entry.author?.name ?? "",
		...entry.tags.map((tag) => tagLabels.get(tag) ?? tag),
	]
		.join(" ")
		.toLowerCase();
}
