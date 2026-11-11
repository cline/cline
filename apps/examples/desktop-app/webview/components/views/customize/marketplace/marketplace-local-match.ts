import type { MarketplaceEntry } from "@/lib/marketplace";

type LocalMatchItem = { matchValues: string[] };

function normalize(value: string): string {
	return value.trim().toLowerCase();
}

export function entryMatchesLocalItem(
	entry: MarketplaceEntry,
	item: LocalMatchItem,
): boolean {
	const values = new Set(
		[entry.id, entry.name, ...entry.install.args]
			.map(normalize)
			.filter(Boolean),
	);
	return item.matchValues
		.map(normalize)
		.some((value) => value && values.has(value));
}

/** Resolve catalog identity consistently in lists and details; never guess an ambiguous match. */
export function findLocalMarketplaceMatch<T extends LocalMatchItem>(
	entry: MarketplaceEntry,
	items: readonly T[],
): T | undefined {
	const candidates = items.filter((item) => entryMatchesLocalItem(entry, item));
	if (candidates.length === 1) return candidates[0];
	const strongValues = new Set(
		[entry.id, entry.name].map(normalize).filter(Boolean),
	);
	const strongCandidates = candidates.filter((item) =>
		item.matchValues.map(normalize).some((value) => strongValues.has(value)),
	);
	return strongCandidates.length === 1 ? strongCandidates[0] : undefined;
}
