// @jsxImportSource @opentui/react
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { palette } from "../../palette";
import {
	buildClineModelPickerDisplayRows,
	type ClineModelPickerEntry,
	getClineModelPickerDisplayRowsWindow,
} from "./cline-model-picker";
import { CHANGE_PROVIDER_ACTION } from "./model-selector";
import { ProviderRow } from "./provider-row";

export const BROWSE_ALL_ACTION = "__browse_all__";
const MAX_VISIBLE_ROWS = 10;

export type ClineModelSelectorResult =
	| string
	| typeof BROWSE_ALL_ACTION
	| typeof CHANGE_PROVIDER_ACTION;

type ClineModelEntriesState =
	| { status: "loading"; message: string }
	| { status: "loaded"; entries: ClineModelPickerEntry[] }
	| { status: "error"; message: string };

function tagColor(tag: string): string {
	if (tag === "FREE") return palette.success;
	if (tag === "BEST") return "magenta";
	return "cyan";
}

export function ClineModelSelectorContent(
	props: ChoiceContext<ClineModelSelectorResult> & {
		currentModel: string;
		currentProviderName: string;
		knownModels?: Record<string, unknown>;
		entries: ClineModelPickerEntry[];
	},
) {
	const {
		resolve,
		dismiss,
		dialogId,
		currentModel,
		currentProviderName,
		knownModels,
		entries,
	} = props;
	const [selected, setSelected] = useState(0);
	const [onProvider, setOnProvider] = useState(false);
	const displayRows = useMemo(() => {
		return buildClineModelPickerDisplayRows(entries, knownModels, currentModel);
	}, [entries, knownModels, currentModel]);

	useEffect(() => {
		setSelected((value) =>
			Math.min(value, Math.max(0, displayRows.length - 1)),
		);
	}, [displayRows.length]);

	const { visibleRows, aboveCount, belowCount, showAbove, showBelow } =
		getClineModelPickerDisplayRowsWindow(
			displayRows,
			selected,
			MAX_VISIBLE_ROWS,
		);

	const resolveEntry = (entryIndex: number) => {
		const entry = entries[entryIndex];
		if (!entry) return;
		if (entry.kind === "model") {
			resolve(entry.model.id);
		} else {
			resolve(BROWSE_ALL_ACTION);
		}
	};

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (key.name === "tab") {
			setOnProvider((v) => !v);
			return;
		}
		if (key.name === "return" || key.name === "enter") {
			if (onProvider) {
				resolve(CHANGE_PROVIDER_ACTION);
				return;
			}
			const row = displayRows[selected];
			if (!row) return;
			resolveEntry(row.entryIndex);
			return;
		}
		const total = displayRows.length;
		if (total === 0) return;
		if (key.name === "up" || (key.ctrl && key.name === "p")) {
			if (!onProvider) {
				setSelected((s) => (s <= 0 ? total - 1 : Math.min(s - 1, total - 1)));
			}
			return;
		}
		if (key.name === "down" || (key.ctrl && key.name === "n")) {
			if (!onProvider) {
				setSelected((s) => (s >= total - 1 ? 0 : s + 1));
			}
			return;
		}
	}, dialogId);

	let lastTier: string | null = null;
	let isFirstHeader = true;
	const renderedRows = visibleRows.flatMap((row) => {
		const entry = entries[row.entryIndex];
		if (!entry) return [];

		const elements = [];
		if (entry.kind === "model" && entry.tier !== lastTier) {
			lastTier = entry.tier;
			const label = entry.tier === "recommended" ? "Recommended" : "Free";
			elements.push(
				<box
					key={`tier-${entry.tier}-${row.entryIndex}`}
					paddingX={1}
					marginTop={isFirstHeader ? 0 : 1}
				>
					<text fg="gray">{label}</text>
				</box>,
			);
			isFirstHeader = false;
		}

		const isSel = row.entryIndex === selected && !onProvider;
		const isGray = row.kind === "browse";
		elements.push(
			<box
				key={row.key}
				paddingX={1}
				flexDirection="row"
				gap={1}
				backgroundColor={isSel ? palette.selection : undefined}
				marginTop={row.kind === "browse" ? 1 : 0}
				onMouseDown={() => resolveEntry(row.entryIndex)}
				overflow="hidden"
				height={1}
			>
				<text fg={isSel ? palette.textOnSelection : "gray"} flexShrink={0}>
					{isSel ? "\u276f" : " "}
				</text>
				<text
					fg={isSel ? palette.textOnSelection : isGray ? "gray" : undefined}
				>
					{row.label}
				</text>
				{row.kind === "model" &&
					row.tags.map((t) => (
						<text
							key={t}
							fg={isSel ? palette.textOnSelection : tagColor(t)}
							flexShrink={0}
						>
							{t}
						</text>
					))}
				{row.kind === "model" && row.isCurrent && (
					<text fg={isSel ? palette.textOnSelection : "gray"} flexShrink={0}>
						(current)
					</text>
				)}
			</box>,
		);

		return elements;
	});

	return (
		<box flexDirection="column" gap={1}>
			<text>
				<strong>Choose a model</strong>
			</text>

			<ProviderRow providerName={currentProviderName} focused={onProvider} />

			<box flexDirection="column">
				{showAbove && (
					<box paddingX={1} justifyContent="center" height={1}>
						<text fg="gray">
							{"\u25b2"} {aboveCount} more
						</text>
					</box>
				)}
				{renderedRows}
				{showBelow && (
					<box paddingX={1} justifyContent="center" height={1}>
						<text fg="gray">
							{"\u25bc"} {belowCount} more
						</text>
					</box>
				)}
			</box>

			<text fg="gray">
				↑/↓ navigate, Enter to select, Tab to change provider, Esc to go back
			</text>
		</box>
	);
}

export function ClineModelSelectorDialogContent(
	props: ChoiceContext<ClineModelSelectorResult> & {
		currentModel: string;
		currentProviderName: string;
		knownModels?: Record<string, unknown>;
		loadEntries: () => Promise<ClineModelPickerEntry[]>;
	},
) {
	const { dismiss, dialogId, loadEntries } = props;
	const [state, setState] = useState<ClineModelEntriesState>({
		status: "loading",
		message: "Loading Cline models...",
	});
	const generation = useRef(0);

	const reload = useCallback(async () => {
		const currentGeneration = generation.current + 1;
		generation.current = currentGeneration;
		setState({ status: "loading", message: "Loading Cline models..." });
		try {
			const entries = await loadEntries();
			if (generation.current === currentGeneration) {
				setState({ status: "loaded", entries });
			}
		} catch (error) {
			if (generation.current === currentGeneration) {
				setState({
					status: "error",
					message: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}, [loadEntries]);

	useEffect(() => {
		void reload();
	}, [reload]);

	useDialogKeyboard((key) => {
		if (state.status === "loaded") {
			return;
		}
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (state.status === "error" && key.name === "r") {
			void reload();
		}
	}, dialogId);

	if (state.status === "loaded") {
		return <ClineModelSelectorContent {...props} entries={state.entries} />;
	}

	if (state.status === "error") {
		return (
			<box flexDirection="column" gap={1}>
				<text fg="cyan">Choose a model</text>
				<ProviderRow providerName={props.currentProviderName} focused={false} />
				<text fg="red">{state.message}</text>
				<text fg="gray">R to retry, Esc to go back</text>
			</box>
		);
	}

	return (
		<box flexDirection="column" gap={1}>
			<text fg="cyan">Choose a model</text>
			<ProviderRow providerName={props.currentProviderName} focused={false} />
			<text fg="gray">{state.message}</text>
			<text fg="gray">Esc to go back</text>
		</box>
	);
}
