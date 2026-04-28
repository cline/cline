import { useMemo, useState } from "react";
import { palette } from "../palette";

export interface SearchableItem {
	key: string;
	label: string;
	detail?: string;
	tag?: string;
	tagColor?: string;
	rightLabel?: string;
	rightLabelColor?: string;
	searchText?: string;
}

export interface SearchableListState {
	search: string;
	setSearch: (v: string) => void;
	selected: number;
	setSelected: (v: number | ((prev: number) => number)) => void;
	filtered: SearchableItem[];
	safeSelected: number;
	moveUp: () => void;
	moveDown: () => void;
	selectedItem: SearchableItem | undefined;
}

function normalize(s: string): string {
	return s.replace(/[^a-z0-9.]/g, "");
}

function fuzzyMatch(text: string, query: string): boolean {
	let qi = 0;
	for (let i = 0; i < text.length && qi < query.length; i++) {
		if (text[i] === query[qi]) qi++;
	}
	return qi === query.length;
}

function scoreItem(item: SearchableItem, query: string): number {
	const targets = [
		item.label.toLowerCase(),
		item.key.toLowerCase(),
		item.searchText?.toLowerCase() ?? "",
	];
	const nQuery = normalize(query);

	let best = 0;
	for (const raw of targets) {
		const t = normalize(raw);
		if (!t) continue;
		if (t === nQuery) return 100;
		if (t.startsWith(nQuery)) best = Math.max(best, 90);
		else if (t.includes(nQuery)) best = Math.max(best, 70);
		else if (fuzzyMatch(t, nQuery)) best = Math.max(best, 30);
	}
	return best;
}

export function useSearchableList(
	items: SearchableItem[],
): SearchableListState {
	const [search, setSearch] = useState("");
	const [selected, setSelected] = useState(0);

	const filtered = useMemo(() => {
		if (!search) return items;
		const q = search.toLowerCase();
		const scored = items
			.map((item) => ({ item, score: scoreItem(item, q) }))
			.filter((r) => r.score > 0);
		scored.sort((a, b) => b.score - a.score);
		return scored.map((r) => r.item);
	}, [items, search]);

	const safeSelected = Math.min(selected, Math.max(0, filtered.length - 1));

	return {
		search,
		setSearch: (v: string) => {
			setSearch(v);
			setSelected(0);
		},
		selected,
		setSelected,
		filtered,
		safeSelected,
		moveUp: () => setSelected((s) => (s <= 0 ? filtered.length - 1 : s - 1)),
		moveDown: () => setSelected((s) => (s >= filtered.length - 1 ? 0 : s + 1)),
		selectedItem: filtered[safeSelected],
	};
}

const MAX_VISIBLE = 10;

export function SearchableList(props: {
	items: SearchableItem[];
	selected: number;
	placeholder?: string;
	onSearchChange: (v: string) => void;
	emptyText?: string;
	borderColor?: string;
}) {
	const {
		items,
		selected,
		placeholder = "Type to search...",
		onSearchChange,
		emptyText = "No results",
		borderColor = "gray",
	} = props;

	const safeSelected = Math.min(selected, Math.max(0, items.length - 1));

	const halfWindow = Math.floor(MAX_VISIBLE / 2);
	let start = Math.max(0, safeSelected - halfWindow);
	if (start + MAX_VISIBLE > items.length) {
		start = Math.max(0, items.length - MAX_VISIBLE);
	}

	const showAbove = start > 0;
	const showBelow = start + MAX_VISIBLE < items.length;
	const itemSlots = MAX_VISIBLE - (showAbove ? 1 : 0) - (showBelow ? 1 : 0);
	const itemStart = showAbove ? start + 1 : start;
	const visible = items.slice(itemStart, itemStart + itemSlots);
	const aboveCount = itemStart;
	const belowCount = items.length - (itemStart + itemSlots);

	return (
		<box flexDirection="column" gap={1}>
			<box border borderStyle="rounded" borderColor={borderColor} paddingX={1}>
				<input
					onInput={onSearchChange}
					placeholder={placeholder}
					flexGrow={1}
					focused
				/>
			</box>

			{items.length === 0 ? (
				<text fg="gray" paddingX={1}>
					{emptyText}
				</text>
			) : (
				<box flexDirection="column">
					{showAbove && (
						<box paddingX={1} justifyContent="center">
							<text fg="gray">
								{"\u25b2"} {aboveCount} more
							</text>
						</box>
					)}
					{visible.map((item, i) => {
						const absIdx = itemStart + i;
						const isSel = absIdx === safeSelected;
						return (
							<box
								key={item.key}
								paddingX={1}
								flexDirection="row"
								gap={1}
								backgroundColor={isSel ? palette.selection : undefined}
								overflow="hidden"
								height={1}
							>
								<text
									fg={isSel ? palette.textOnSelection : "gray"}
									flexShrink={0}
								>
									{isSel ? "\u276f" : " "}
								</text>
								<text fg={isSel ? palette.textOnSelection : undefined}>
									{item.label}
								</text>
								{item.detail && (
									<text
										fg={isSel ? palette.textOnSelection : "gray"}
										flexShrink={1}
									>
										{item.detail}
									</text>
								)}
								{item.tag && (
									<text
										fg={
											isSel
												? palette.textOnSelection
												: (item.tagColor ?? "gray")
										}
										flexShrink={0}
									>
										{item.tag}
									</text>
								)}
								{item.rightLabel && (
									<text
										fg={
											isSel
												? palette.textOnSelection
												: (item.rightLabelColor ?? palette.success)
										}
										flexShrink={0}
									>
										{item.rightLabel}
									</text>
								)}
							</box>
						);
					})}
					{showBelow && (
						<box paddingX={1} justifyContent="center">
							<text fg="gray">
								{"\u25bc"} {belowCount} more
							</text>
						</box>
					)}
				</box>
			)}
		</box>
	);
}
