import { useMemo, useState } from "react";
import { useTerminalBackground } from "../hooks/use-terminal-background";
import { getDefaultForeground, palette } from "../palette";

export interface SearchableItem {
	key: string;
	label: string;
	section?: string;
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

export type CreateSearchableItem = (
	search: string,
	filteredItems: SearchableItem[],
) => SearchableItem | undefined;

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

function createSectionOrder(items: SearchableItem[]): Map<string, number> {
	const order = new Map<string, number>();
	for (const item of items) {
		if (!item.section || order.has(item.section)) continue;
		order.set(item.section, order.size);
	}
	return order;
}

export type SearchableListRow =
	| { kind: "header"; key: string; label: string }
	| { kind: "item"; key: string; item: SearchableItem; itemIndex: number };

export function buildSearchableListRows(
	items: SearchableItem[],
): SearchableListRow[] {
	const rows: SearchableListRow[] = [];
	let previousSection: string | undefined;
	for (const [itemIndex, item] of items.entries()) {
		if (item.section && item.section !== previousSection) {
			rows.push({
				kind: "header",
				key: `section-${item.section}-${itemIndex}`,
				label: item.section,
			});
		}
		rows.push({ kind: "item", key: item.key, item, itemIndex });
		previousSection = item.section;
	}
	return rows;
}

function countItemRows(rows: SearchableListRow[]): number {
	return rows.reduce((count, row) => count + (row.kind === "item" ? 1 : 0), 0);
}

export function getSearchableListRowsWindow(
	items: SearchableItem[],
	selected: number,
	maxVisible: number,
): {
	visibleRows: SearchableListRow[];
	aboveCount: number;
	belowCount: number;
	showAbove: boolean;
	showBelow: boolean;
} {
	const rows = buildSearchableListRows(items);
	if (rows.length === 0) {
		return {
			visibleRows: [],
			aboveCount: 0,
			belowCount: 0,
			showAbove: false,
			showBelow: false,
		};
	}

	const selectedRowIndex = Math.max(
		0,
		rows.findIndex((row) => row.kind === "item" && row.itemIndex === selected),
	);
	let visibleLimit = maxVisible;
	let start = 0;
	let end = rows.length;

	for (let i = 0; i < 3; i++) {
		const showAbove = start > 0;
		const showBelow = end < rows.length;
		visibleLimit = Math.max(
			1,
			maxVisible - (showAbove ? 1 : 0) - (showBelow ? 1 : 0),
		);
		start = Math.max(0, selectedRowIndex - Math.floor(visibleLimit / 2));
		if (start + visibleLimit > rows.length) {
			start = Math.max(0, rows.length - visibleLimit);
		}
		end = Math.min(rows.length, start + visibleLimit);
	}

	if (start > 0 && countItemRows(rows.slice(0, start)) === 0) {
		start = 0;
		const showBelow = rows.length > maxVisible;
		visibleLimit = Math.max(1, maxVisible - (showBelow ? 1 : 0));
		end = Math.min(rows.length, visibleLimit);
	}

	const aboveCount = countItemRows(rows.slice(0, start));
	const belowCount = countItemRows(rows.slice(end));
	return {
		visibleRows: rows.slice(start, end),
		aboveCount,
		belowCount,
		showAbove: aboveCount > 0,
		showBelow: belowCount > 0,
	};
}

export function useSearchableList(
	items: SearchableItem[],
	createItem?: CreateSearchableItem,
): SearchableListState {
	const [search, setSearch] = useState("");
	const [selected, setSelected] = useState(0);

	const filtered = useMemo(() => {
		const baseItems = (() => {
			if (!search) return items;
			const q = search.toLowerCase();
			const sectionOrder = createSectionOrder(items);
			const scored = items
				.map((item) => ({ item, score: scoreItem(item, q) }))
				.filter((r) => r.score > 0);
			scored.sort((a, b) => {
				if (sectionOrder.size > 0) {
					const aRank = a.item.section
						? (sectionOrder.get(a.item.section) ?? Number.MAX_SAFE_INTEGER)
						: Number.MAX_SAFE_INTEGER;
					const bRank = b.item.section
						? (sectionOrder.get(b.item.section) ?? Number.MAX_SAFE_INTEGER)
						: Number.MAX_SAFE_INTEGER;
					if (aRank !== bRank) return aRank - bRank;
				}
				return b.score - a.score;
			});
			return scored.map((r) => r.item);
		})();
		const created = createItem?.(search, baseItems);
		return created ? [...baseItems, created] : baseItems;
	}, [items, search, createItem]);

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
		moveUp: () =>
			setSelected((s) =>
				filtered.length === 0 ? 0 : s <= 0 ? filtered.length - 1 : s - 1,
			),
		moveDown: () =>
			setSelected((s) =>
				filtered.length === 0 ? 0 : s >= filtered.length - 1 ? 0 : s + 1,
			),
		selectedItem: filtered[safeSelected],
	};
}

const MAX_VISIBLE = 10;

export function SearchableList(props: {
	items: SearchableItem[];
	selected: number;
	placeholder?: string;
	onSearchChange: (v: string) => void;
	onItemSelect?: (item: SearchableItem) => void;
	emptyText?: string;
	borderColor?: string;
}) {
	const terminalBg = useTerminalBackground();
	const defaultFg = getDefaultForeground(terminalBg);
	const {
		items,
		selected,
		placeholder = "Type to search...",
		onSearchChange,
		onItemSelect,
		emptyText = "No results",
		borderColor = "gray",
	} = props;

	const safeSelected = Math.min(selected, Math.max(0, items.length - 1));
	const { visibleRows, aboveCount, belowCount, showAbove, showBelow } =
		getSearchableListRowsWindow(items, safeSelected, MAX_VISIBLE);

	return (
		<box flexDirection="column" gap={1}>
			<box border borderStyle="rounded" borderColor={borderColor} paddingX={1}>
				<input
					onInput={onSearchChange}
					placeholder={placeholder}
					textColor={defaultFg}
					focusedTextColor={defaultFg}
					cursorColor={defaultFg}
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
					{visibleRows.map((row) => {
						if (row.kind === "header") {
							return (
								<box key={row.key} paddingX={1} height={1}>
									<text fg="gray">{row.label}</text>
								</box>
							);
						}
						const item = row.item;
						const isSel = row.itemIndex === safeSelected;
						return (
							<box
								key={item.key}
								paddingX={1}
								flexDirection="row"
								gap={1}
								backgroundColor={isSel ? palette.selection : undefined}
								onMouseDown={() => onItemSelect?.(item)}
								overflow="hidden"
								height={1}
							>
								<text
									fg={isSel ? palette.textOnSelection : "gray"}
									flexShrink={0}
								>
									{isSel ? "\u276f" : " "}
								</text>
								<text fg={isSel ? palette.textOnSelection : defaultFg}>
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
