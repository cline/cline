// @jsxImportSource @opentui/react

import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDialogPalette } from "../../hooks/use-theme";
import type { DialogPalette } from "../../themes";
import {
	CLINE_MODEL_PICKER_TIER_LABELS,
	type ClineModelPickerEntry,
	type ClineModelSearchRow,
	freeTierDescriptionFor,
	searchFeaturedModels,
} from "./cline-model-entries";
import type { ModelSearchCandidate } from "./model-search";
import { CHANGE_PROVIDER_ACTION } from "./model-selector";
import { ProviderRow } from "./provider-row";

export const BROWSE_ALL_ACTION = "__browse_all__";

const MAX_VISIBLE_SEARCH_RESULTS = 10;

type ClineModelEntriesState =
	| { status: "loading"; message: string }
	| { status: "loaded"; entries: ClineModelPickerEntry[] }
	| { status: "error"; message: string };

function tagColor(tag: string, palette: DialogPalette): string {
	if (tag === "FREE") return palette.success;
	if (tag === "BEST") return "magenta";
	return palette.act;
}

function SearchResultRow(props: {
	row: ClineModelSearchRow;
	selected: boolean;
	isCurrent: boolean;
}) {
	const { row, selected, isCurrent } = props;
	const palette = useDialogPalette();
	return (
		<box
			paddingX={1}
			flexDirection="row"
			gap={1}
			backgroundColor={selected ? palette.selection : undefined}
			overflow="hidden"
			height={1}
		>
			<text fg={selected ? palette.textOnSelection : "gray"} flexShrink={0}>
				{selected ? "\u276f" : " "}
			</text>
			<text fg={selected ? palette.textOnSelection : undefined}>
				{row.name}
			</text>
			{row.tags.map((tag) => (
				<text
					key={tag}
					fg={selected ? palette.textOnSelection : tagColor(tag, palette)}
					flexShrink={0}
				>
					{tag}
				</text>
			))}
			{isCurrent && (
				<text fg={selected ? palette.textOnSelection : "gray"} flexShrink={0}>
					(current)
				</text>
			)}
		</box>
	);
}

export function ClineModelSelectorContent(
	props: ChoiceContext<string> & {
		currentModel: string;
		currentProviderName: string;
		entries: ClineModelPickerEntry[];
		/** Full catalog searched alongside the featured entries. */
		allModels?: ModelSearchCandidate[];
	},
) {
	const {
		resolve,
		dismiss,
		dialogId,
		currentModel,
		currentProviderName,
		entries,
		allModels,
	} = props;
	const palette = useDialogPalette();
	const [selected, setSelected] = useState(0);
	const [onProvider, setOnProvider] = useState(false);
	const [search, setSearch] = useState("");

	const searchResults = useMemo(
		() =>
			search.trim()
				? searchFeaturedModels({
						entries,
						allModels: allModels ?? [],
						query: search,
					})
				: null,
		[search, entries, allModels],
	);

	const displayRows = useMemo(() => {
		const rows: {
			key: string;
			kind: "header" | "model" | "browse";
			label: string;
			description?: string;
			tags: string[];
			isCurrent: boolean;
			entryIndex: number;
		}[] = [];
		let lastTier: string | null = null;
		const freeTierDescription = freeTierDescriptionFor(entries);
		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			if (!entry) continue;
			if (entry.kind === "model") {
				if (entry.tier !== lastTier) {
					lastTier = entry.tier;
					rows.push({
						key: `tier-${entry.tier}`,
						kind: "header",
						label: CLINE_MODEL_PICKER_TIER_LABELS[entry.tier],
						description:
							entry.tier === "free" ? freeTierDescription : undefined,
						tags: [],
						isCurrent: false,
						entryIndex: -1,
					});
				}
				rows.push({
					key: entry.model.id,
					kind: "model",
					// Names arrive display-ready from the host's recommended-models feed
					label: entry.model.name || entry.model.id,
					tags: entry.model.tags,
					isCurrent: currentModel === entry.model.id,
					entryIndex: i,
				});
			} else {
				rows.push({
					key: "browse-all",
					kind: "browse",
					label: "Browse all models...",
					tags: [],
					isCurrent: false,
					entryIndex: i,
				});
			}
		}
		return rows;
	}, [entries, currentModel]);

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
			if (searchResults) {
				const row = searchResults[selected];
				if (row) resolve(row.id);
				return;
			}
			const entry = entries[selected];
			if (!entry) return;
			if (entry.kind === "model") {
				resolve(entry.model.id);
			} else {
				resolve(BROWSE_ALL_ACTION);
			}
			return;
		}
		const total = searchResults ? searchResults.length : entries.length;
		if (total === 0) return;
		if (key.name === "up" || (key.ctrl && key.name === "p")) {
			if (!onProvider) {
				setSelected((s) => (s <= 0 ? total - 1 : s - 1));
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

	const searchWindow = useMemo(() => {
		if (!searchResults) {
			return null;
		}
		if (searchResults.length <= MAX_VISIBLE_SEARCH_RESULTS) {
			return { items: searchResults, startIndex: 0 };
		}
		const safeSelected = Math.min(
			selected,
			Math.max(0, searchResults.length - 1),
		);
		const half = Math.floor(MAX_VISIBLE_SEARCH_RESULTS / 2);
		let start = Math.max(0, safeSelected - half);
		const end = Math.min(
			searchResults.length,
			start + MAX_VISIBLE_SEARCH_RESULTS,
		);
		if (end - start < MAX_VISIBLE_SEARCH_RESULTS) {
			start = Math.max(0, end - MAX_VISIBLE_SEARCH_RESULTS);
		}
		return { items: searchResults.slice(start, end), startIndex: start };
	}, [searchResults, selected]);

	return (
		<box flexDirection="column" gap={1}>
			<text>
				<strong>Choose a model</strong>
			</text>

			<ProviderRow providerName={currentProviderName} focused={onProvider} />

			<box border borderStyle="rounded" borderColor="gray" paddingX={1}>
				<input
					onInput={(value: string) => {
						setSearch(value);
						setSelected(0);
						setOnProvider(false);
					}}
					placeholder="Search models..."
					flexGrow={1}
					focused
				/>
			</box>

			{searchResults && searchWindow ? (
				<box flexDirection="column">
					{searchResults.length === 0 && <text fg="gray">No models match</text>}
					{searchWindow.startIndex > 0 && (
						<box paddingX={1} justifyContent="center">
							<text fg="gray">
								{"\u25b2"} {searchWindow.startIndex} more
							</text>
						</box>
					)}
					{searchWindow.items.map((row, i) => (
						<SearchResultRow
							key={row.id}
							row={row}
							selected={searchWindow.startIndex + i === selected}
							isCurrent={currentModel === row.id}
						/>
					))}
					{searchWindow.startIndex + searchWindow.items.length <
						searchResults.length && (
						<box paddingX={1} justifyContent="center">
							<text fg="gray">
								{"\u25bc"}{" "}
								{searchResults.length -
									searchWindow.startIndex -
									searchWindow.items.length}{" "}
								more
							</text>
						</box>
					)}
				</box>
			) : (
				<box flexDirection="column">
					{displayRows.map((row, idx) => {
						if (row.kind === "header") {
							const isFirst = idx === 0;
							return (
								<box
									key={row.key}
									paddingX={1}
									marginTop={isFirst ? 0 : 1}
									flexDirection="column"
								>
									<text fg="gray">{row.label}</text>
									{row.description && (
										<text fg="gray">
											<em>{row.description}</em>
										</text>
									)}
								</box>
							);
						}
						const isSel = row.entryIndex === selected && !onProvider;
						const isGray = row.kind === "browse";
						return (
							<box
								key={row.key}
								paddingX={1}
								flexDirection="row"
								gap={1}
								backgroundColor={isSel ? palette.selection : undefined}
								marginTop={row.kind === "browse" ? 1 : 0}
							>
								<text
									fg={isSel ? palette.textOnSelection : "gray"}
									flexShrink={0}
								>
									{isSel ? "\u276f" : " "}
								</text>
								<text
									fg={
										isSel
											? palette.textOnSelection
											: isGray
												? "gray"
												: undefined
									}
								>
									{row.label}
								</text>
								{row.tags.map((t) => (
									<text
										key={t}
										fg={isSel ? palette.textOnSelection : tagColor(t, palette)}
										flexShrink={0}
									>
										{t}
									</text>
								))}
								{row.isCurrent && (
									<text
										fg={isSel ? palette.textOnSelection : "gray"}
										flexShrink={0}
									>
										(current)
									</text>
								)}
							</box>
						);
					})}
				</box>
			)}

			<text fg="gray">
				Type to search, ↑/↓ navigate, Enter to select, Tab to change provider,
				Esc to go back
			</text>
		</box>
	);
}

export function ClineModelSelectorDialogContent(
	props: ChoiceContext<string> & {
		currentModel: string;
		currentProviderName: string;
		loadEntries: () => Promise<ClineModelPickerEntry[]>;
		/** Full catalog searched alongside the featured entries. */
		allModels?: ModelSearchCandidate[];
	},
) {
	const { dismiss, dialogId, loadEntries } = props;
	const palette = useDialogPalette();
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
				<text fg={palette.act}>Choose a model</text>
				<ProviderRow providerName={props.currentProviderName} focused={false} />
				<text fg="red">{state.message}</text>
				<text fg="gray">R to retry, Esc to go back</text>
			</box>
		);
	}

	return (
		<box flexDirection="column" gap={1}>
			<text fg={palette.act}>Choose a model</text>
			<ProviderRow providerName={props.currentProviderName} focused={false} />
			<text fg="gray">{state.message}</text>
			<text fg="gray">Esc to go back</text>
		</box>
	);
}
