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
export type ClineModelTier = "recommended" | "free";

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
			kind: "model";
			key: string;
			label: string;
			tags: string[];
			isCurrent: boolean;
			entryIndex: number;
	  }
	| {
			kind: "browse";
			key: string;
			label: string;
			entryIndex: number;
	  };

export function buildClineModelPickerDisplayRows(
	entries: ClineModelPickerEntry[],
	knownModels?: Record<string, unknown>,
	currentModelId?: string,
): ClineModelPickerDisplayRow[] {
	const rows: ClineModelPickerDisplayRow[] = [];

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (!entry) continue;

		if (entry.kind === "model") {
			rows.push({
				kind: "model",
				key: `${entry.tier}-${entry.model.id}-${i}`,
				label: resolveClineModelDisplayName(entry.model.id, knownModels),
				tags: entry.model.tags,
				isCurrent: currentModelId === entry.model.id,
				entryIndex: i,
			});
			continue;
		}

		rows.push({
			kind: "browse",
			key: "browse-all",
			label: "Browse all models...",
			entryIndex: i,
		});
	}

	return rows;
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

	const selectedRowIndex = Math.max(0, selected);
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

	const aboveCount = start;
	const belowCount = rows.length - end;

	return {
		visibleRows: rows.slice(start, end),
		aboveCount,
		belowCount,
		showAbove: aboveCount > 0,
		showBelow: belowCount > 0,
	};
}
