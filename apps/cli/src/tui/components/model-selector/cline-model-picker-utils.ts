import type {
	ClineRecommendedModel,
	ClineRecommendedModelsData,
} from "@cline/core";

export interface ClineModelPickerBrowse {
	kind: "browse";
}

export type ClineModelsEntry = {
	kind: "model";
	tier: ClineModelTier;
	model: ClineRecommendedModel;
};
export type ClineModelPickerEntry = ClineModelsEntry | ClineModelPickerBrowse;
export type ClineModelTier = "recommended" | "free" | "clinePass";
export type ClineModelPickerExpandedTiers = Record<ClineModelTier, boolean>;

const DEFAULT_EXPANDED_TIERS: ClineModelPickerExpandedTiers = {
	clinePass: false,
	recommended: false,
	free: false,
};

export function resolveClineModelDisplayName(
	modelId: string,
	knownModels?: Record<string, unknown>,
): string {
	if (knownModels) {
		const candidates = [modelId, modelId.split("/").pop()];
		for (const key of candidates) {
			if (!key) continue;
			const hit = knownModels[key] as { name?: string } | undefined;
			if (hit?.name) return hit.name;
		}
	}
	return modelId.includes("/")
		? (modelId.split("/").pop() ?? modelId)
		: modelId;
}

export function buildClineModelEntries(
	data: ClineRecommendedModelsData,
): ClineModelPickerEntry[] {
	const entries: ClineModelPickerEntry[] = [
		...data.clinePass.map((model) => ({
			kind: "model" as const,
			tier: "clinePass" as const,
			model,
		})),
		...data.recommended.map((model) => ({
			kind: "model" as const,
			tier: "recommended" as const,
			model,
		})),
		...data.free.map((model) => ({
			kind: "model" as const,
			tier: "free" as const,
			model,
		})),
		{
			kind: "browse",
		},
	];

	return entries;
}

export type ClineModelPickerDisplayRow =
	| {
			kind: "header";
			key: string;
			label: string;
			tier: ClineModelTier;
			isExpanded: boolean;
			count: number;
			focusIndex: number;
	  }
	| {
			kind: "model";
			key: string;
			label: string;
			tags: string[];
			isCurrent: boolean;
			entryIndex: number;
			selectableIndex: number;
			focusIndex: number;
	  }
	| {
			kind: "browse";
			key: string;
			label: string;
			entryIndex: number;
			selectableIndex: number;
			focusIndex: number;
	  };

function normalizeExpandedTiers(
	expandedTiers?: Partial<ClineModelPickerExpandedTiers>,
): ClineModelPickerExpandedTiers {
	return {
		recommended:
			expandedTiers?.recommended ?? DEFAULT_EXPANDED_TIERS.recommended,
		free: expandedTiers?.free ?? DEFAULT_EXPANDED_TIERS.free,
		clinePass: expandedTiers?.clinePass ?? DEFAULT_EXPANDED_TIERS.clinePass,
	};
}

function countModelsInTier(
	entries: ClineModelPickerEntry[],
	tier: ClineModelTier,
): number {
	return entries.reduce(
		(count, entry) =>
			count + (entry.kind === "model" && entry.tier === tier ? 1 : 0),
		0,
	);
}

export function getVisibleClineModelPickerEntries(
	entries: ClineModelPickerEntry[],
	expandedTiers?: Partial<ClineModelPickerExpandedTiers>,
): ClineModelPickerEntry[] {
	const expanded = normalizeExpandedTiers(expandedTiers);
	return entries.filter((entry) => {
		if (entry.kind === "browse") return true;
		return expanded[entry.tier];
	});
}

const TierTitle: Record<ClineModelTier, string> = {
	recommended: "Recommended",
	clinePass: "Cline Pass",
	free: "Free",
};

export function buildClineModelPickerDisplayRows(
	entries: ClineModelPickerEntry[],
	knownModels?: Record<string, unknown>,
	currentModelId?: string,
	expandedTiers?: Partial<ClineModelPickerExpandedTiers>,
): ClineModelPickerDisplayRow[] {
	const rows: ClineModelPickerDisplayRow[] = [];
	const expanded = normalizeExpandedTiers(expandedTiers);
	let lastTier: ClineModelTier | null = null;
	let selectableIndex = 0;
	let focusIndex = 0;

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (!entry) continue;

		if (entry.kind === "model") {
			if (entry.tier !== lastTier) {
				lastTier = entry.tier;
				rows.push({
					kind: "header",
					key: `tier-${entry.tier}`,
					label: TierTitle[entry.tier],
					tier: entry.tier,
					isExpanded: expanded[entry.tier],
					count: countModelsInTier(entries, entry.tier),
					focusIndex,
				});
				focusIndex++;
			}
			if (!expanded[entry.tier]) continue;

			rows.push({
				kind: "model",
				key: `${entry.tier}-${entry.model.id}-${i}`,
				label: resolveClineModelDisplayName(entry.model.id, knownModels),
				tags: entry.model.tags,
				isCurrent: currentModelId === entry.model.id,
				entryIndex: i,
				selectableIndex,
				focusIndex,
			});
			selectableIndex++;
			focusIndex++;
			continue;
		}

		rows.push({
			kind: "browse",
			key: "browse-all",
			label: "Browse all models...",
			entryIndex: i,
			selectableIndex,
			focusIndex,
		});
		selectableIndex++;
		focusIndex++;
	}

	return rows;
}

function countFocusableRows(rows: ClineModelPickerDisplayRow[]): number {
	return rows.length;
}

export function getClineModelPickerDisplayRowsWindow(
	rows: ClineModelPickerDisplayRow[],
	selected: number,
	maxVisibleRows: number,
) {
	if (rows.length <= maxVisibleRows) {
		return {
			visibleRows: rows,
			aboveCount: 0,
			belowCount: 0,
			showAbove: false,
			showBelow: false,
		};
	}

	const selectedRowIndex = Math.max(
		0,
		rows.findIndex((row) => row.focusIndex === selected),
	);
	let visibleLimit = maxVisibleRows;
	let start = 0;
	let end = rows.length;

	for (let i = 0; i < 3; i++) {
		const showAbove = start > 0;
		const showBelow = end < rows.length;
		visibleLimit = Math.max(
			1,
			maxVisibleRows - (showAbove ? 1 : 0) - (showBelow ? 1 : 0),
		);
		start = Math.max(0, selectedRowIndex - Math.floor(visibleLimit / 2));
		if (start + visibleLimit > rows.length) {
			start = Math.max(0, rows.length - visibleLimit);
		}
		end = Math.min(rows.length, start + visibleLimit);
	}

	if (start > 0 && countFocusableRows(rows.slice(0, start)) === 0) {
		start = 0;
		const showBelow = rows.length > maxVisibleRows;
		visibleLimit = Math.max(1, maxVisibleRows - (showBelow ? 1 : 0));
		end = Math.min(rows.length, visibleLimit);
	}

	const aboveCount = countFocusableRows(rows.slice(0, start));
	const belowCount = countFocusableRows(rows.slice(end));

	return {
		visibleRows: rows.slice(start, end),
		aboveCount,
		belowCount,
		showAbove: aboveCount > 0,
		showBelow: belowCount > 0,
	};
}

export function getClineModelPickerRowByFocusIndex(
	rows: ClineModelPickerDisplayRow[],
	focusIndex: number,
): ClineModelPickerDisplayRow | undefined {
	return rows.find((row) => row.focusIndex === focusIndex);
}
