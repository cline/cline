// @jsxImportSource @opentui/react

import {
	type ClineRecommendedModelsData,
	fetchClineRecommendedModels,
} from "@cline/core";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import "opentui-spinner/react";
import { palette } from "../../palette";
import {
	buildClineModelPickerDisplayRows,
	type ClineModelPickerDisplayRow,
	type ClineModelPickerEntry,
	getClineModelPickerDisplayRowsWindow,
} from "./cline-model-picker-utils";

export {
	buildClineModelEntries,
	buildClineModelPickerDisplayRows,
	type ClineModelPickerDisplayRow,
	type ClineModelPickerEntry,
	type ClineModelTier,
	getClineModelPickerDisplayRowsWindow,
} from "./cline-model-picker-utils";

const MAX_VISIBLE_ROWS = 10;

function tagColor(tag: string): string {
	if (tag === "FREE") return palette.success;
	if (tag === "BEST") return "magenta";
	return "cyan";
}

export function useClineRecommendedModels() {
	const [data, setData] = useState<ClineRecommendedModelsData | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		fetchClineRecommendedModels()
			.then((result) => {
				if (!cancelled) setData(result);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	return { data, loading };
}

function ClineModelRow(props: {
	row: Extract<ClineModelPickerDisplayRow, { kind: "model" | "browse" }>;
	isSelected: boolean;
	onSelect?: (entryIndex: number, entry: ClineModelPickerEntry) => void;
	entry: ClineModelPickerEntry;
}) {
	const { row, isSelected, onSelect, entry } = props;
	const isBrowse = row.kind === "browse";
	return (
		<box
			key={row.key}
			paddingX={1}
			flexDirection="row"
			gap={1}
			backgroundColor={isSelected ? palette.selection : undefined}
			marginTop={isBrowse ? 1 : 0}
			onMouseDown={() => onSelect?.(row.entryIndex, entry)}
			overflow="hidden"
			height={1}
		>
			<text fg={isSelected ? palette.textOnSelection : "gray"} flexShrink={0}>
				{isSelected ? "\u276f" : " "}
			</text>
			<text
				fg={
					isSelected ? palette.textOnSelection : isBrowse ? "gray" : undefined
				}
			>
				{row.label}
			</text>
			{row.kind === "model" &&
				row.tags.map((t) => (
					<text
						key={t}
						fg={isSelected ? palette.textOnSelection : tagColor(t)}
						flexShrink={0}
					>
						{t}
					</text>
				))}
			{row.kind === "model" && row.isCurrent && (
				<text
					fg={isSelected ? palette.textOnSelection : palette.success}
					flexShrink={0}
				>
					(current)
				</text>
			)}
		</box>
	);
}

export function ClineModelPicker(props: {
	entries: ClineModelPickerEntry[];
	selected: number;
	loading?: boolean;
	knownModels?: Record<string, unknown>;
	currentModelId?: string;
	maxVisibleRows?: number;
	onEntrySelect?: (entryIndex: number, entry: ClineModelPickerEntry) => void;
}) {
	const {
		entries,
		selected,
		loading,
		knownModels,
		currentModelId,
		maxVisibleRows = MAX_VISIBLE_ROWS,
		onEntrySelect,
	} = props;
	const displayRows = useMemo(
		() =>
			buildClineModelPickerDisplayRows(entries, knownModels, currentModelId),
		[entries, knownModels, currentModelId],
	);

	if (loading) {
		return (
			<box flexDirection="row" gap={1} paddingX={1}>
				<spinner name="dots" color="gray" />
				<text fg="gray">Loading models...</text>
			</box>
		);
	}

	const { visibleRows, aboveCount, belowCount, showAbove, showBelow } =
		getClineModelPickerDisplayRowsWindow(displayRows, selected, maxVisibleRows);
	const rows: ReactNode[] = [];
	let lastTier: string | null = null;
	let isFirstHeader = true;

	if (showAbove) {
		rows.push(
			<box key="more-above" paddingX={1} justifyContent="center" height={1}>
				<text fg="gray">
					{"\u25b2"} {aboveCount} more
				</text>
			</box>,
		);
	}

	for (const row of visibleRows) {
		const entry = entries[row.entryIndex];
		if (!entry) continue;

		if (entry.kind === "model" && entry.tier !== lastTier) {
			lastTier = entry.tier;
			const label = entry.tier === "recommended" ? "Recommended" : "Free";
			rows.push(
				<box
					key={`tier-${entry.tier}`}
					paddingX={1}
					marginTop={isFirstHeader ? 0 : 1}
				>
					<text fg="gray">{label}</text>
				</box>,
			);
			isFirstHeader = false;
		}

		rows.push(
			<ClineModelRow
				key={row.key}
				row={row}
				entry={entry}
				isSelected={row.entryIndex === selected}
				onSelect={onEntrySelect}
			/>,
		);
	}

	if (showBelow) {
		rows.push(
			<box key="more-below" paddingX={1} justifyContent="center" height={1}>
				<text fg="gray">
					{"\u25bc"} {belowCount} more
				</text>
			</box>,
		);
	}

	return <box flexDirection="column">{rows}</box>;
}
