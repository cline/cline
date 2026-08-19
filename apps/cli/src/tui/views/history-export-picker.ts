import type { HistoryExportFormat } from "../../session/history-export";

export const HISTORY_EXPORT_OPTIONS = [
	{
		format: "html",
		label: "HTML",
		description: "Standalone, readable conversation",
	},
	{
		format: "json",
		label: "JSON",
		description: "Structured session messages and metadata",
	},
] as const satisfies ReadonlyArray<{
	format: HistoryExportFormat;
	label: string;
	description: string;
}>;

export type HistoryExportPickerState = {
	sessionId: string;
	selectedIndex: number;
};

export type HistoryPickerKey = {
	name?: string;
	ctrl?: boolean;
};

export type HistoryExportPickerAction =
	| { kind: "cancel" }
	| {
			kind: "export";
			sessionId: string;
			format: HistoryExportFormat;
	  }
	| { kind: "update"; state: HistoryExportPickerState }
	| { kind: "ignore" };

export function resolveHistoryExportPickerAction(
	state: HistoryExportPickerState,
	key: HistoryPickerKey,
): HistoryExportPickerAction {
	if (key.name === "escape") {
		return { kind: "cancel" };
	}
	if (key.name === "return" || key.name === "enter") {
		const option = HISTORY_EXPORT_OPTIONS[state.selectedIndex];
		return option
			? {
					kind: "export",
					sessionId: state.sessionId,
					format: option.format,
				}
			: { kind: "ignore" };
	}
	if (
		key.name === "up" ||
		key.name === "left" ||
		(key.ctrl && key.name === "p")
	) {
		return {
			kind: "update",
			state: {
				...state,
				selectedIndex:
					state.selectedIndex <= 0
						? HISTORY_EXPORT_OPTIONS.length - 1
						: state.selectedIndex - 1,
			},
		};
	}
	if (
		key.name === "down" ||
		key.name === "right" ||
		(key.ctrl && key.name === "n")
	) {
		return {
			kind: "update",
			state: {
				...state,
				selectedIndex:
					state.selectedIndex >= HISTORY_EXPORT_OPTIONS.length - 1
						? 0
						: state.selectedIndex + 1,
			},
		};
	}
	return { kind: "ignore" };
}

export function buildHistoryFooterText(input: {
	canDelete: boolean;
	canExport: boolean;
}): string {
	return [
		"\u2191/\u2193 navigate",
		"Enter to resume",
		input.canDelete ? "\u2190 delete" : undefined,
		input.canExport ? "\u2192 export" : undefined,
		"Esc to close",
	]
		.filter((part): part is string => part !== undefined)
		.join(", ");
}
