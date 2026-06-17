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
	type ClineModelPickerExpandedTiers,
	type ClineModelTier,
	getClineModelPickerDisplayRowsWindow,
} from "./cline-model-picker-utils";

export {
	buildClineModelEntries,
	buildClineModelPickerDisplayRows,
	type ClineModelPickerDisplayRow,
	type ClineModelPickerEntry,
	type ClineModelPickerExpandedTiers,
	type ClineModelProviderId,
	type ClineModelTier,
	getClineModelPickerDisplayRowsWindow,
	getClineModelPickerRowByFocusIndex,
	getVisibleClineModelPickerEntries,
	resolveClineModelEntryProviderId,
	resolveClineModelProviderId,
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
	onSelect?: (selectableIndex: number, entry: ClineModelPickerEntry) => void;
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
			onMouseDown={() => onSelect?.(row.selectableIndex, entry)}
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
	expandedTiers?: Partial<ClineModelPickerExpandedTiers>;
	maxVisibleRows?: number;
	onEntrySelect?: (
		selectableIndex: number,
		entry: ClineModelPickerEntry,
	) => void;
	onToggleTier?: (tier: ClineModelTier) => void;
}) {
	const {
		entries,
		selected,
		loading,
		knownModels,
		currentModelId,
		expandedTiers,
		maxVisibleRows = MAX_VISIBLE_ROWS,
		onEntrySelect,
		onToggleTier,
	} = props;
	const displayRows = useMemo(
		() =>
			buildClineModelPickerDisplayRows(
				entries,
				knownModels,
				currentModelId,
				expandedTiers,
			),
		[entries, knownModels, currentModelId, expandedTiers],
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
		if (row.kind === "header") {
			const isSelected = row.focusIndex === selected;
			rows.push(
				<box
					key={row.key}
					paddingX={1}
					height={1}
					flexDirection="row"
					gap={1}
					backgroundColor={isSelected ? palette.selection : undefined}
					onMouseDown={() => onToggleTier?.(row.tier)}
				>
					<text
						fg={isSelected ? palette.textOnSelection : "gray"}
						flexShrink={0}
					>
						{isSelected ? "\u276f" : " "}
					</text>
					<text
						fg={isSelected ? palette.textOnSelection : "gray"}
						flexShrink={0}
					>
						{row.isExpanded ? "▾" : "▸"}
					</text>
					<text fg={isSelected ? palette.textOnSelection : "gray"}>
						{row.label}
					</text>
				</box>,
			);
			continue;
		}

		const entry = entries[row.entryIndex];
		if (!entry) continue;
		rows.push(
			<box marginLeft={4}>
				<ClineModelRow
					key={row.key}
					row={row}
					entry={entry}
					isSelected={row.focusIndex === selected}
					onSelect={onEntrySelect}
				/>
			</box>,
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

	return (
		<box flexDirection="column" paddingTop={1}>
			{rows}
		</box>
	);
}
