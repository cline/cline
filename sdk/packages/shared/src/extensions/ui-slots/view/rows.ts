import type { ComposerSuggestionItem } from "../contracts";
import type { SuggestionsLocal } from "./types";

export function visibleItems(
	local: SuggestionsLocal,
): ComposerSuggestionItem[] {
	const items = local.envelope?.state?.items ?? [];
	return items.filter((item) => !local.pendingSkipIds.includes(item.id));
}

export function highlightedIndex(
	rows: readonly ComposerSuggestionItem[],
	highlightId: string | undefined,
): number {
	return Math.max(
		0,
		rows.findIndex((item) => item.id === highlightId),
	);
}
