// @jsxImportSource @opentui/react
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { palette } from "../../palette";
import type { ClineModelPickerEntry } from "./cline-model-picker";
import { CHANGE_PROVIDER_ACTION } from "./model-selector";
import { ProviderRow } from "./provider-row";

export const BROWSE_ALL_ACTION = "__browse_all__";

type ClineModelEntriesState =
	| { status: "loading"; message: string }
	| { status: "loaded"; entries: ClineModelPickerEntry[] }
	| { status: "error"; message: string };

function tagColor(tag: string): string {
	if (tag === "FREE") return palette.success;
	if (tag === "BEST") return "magenta";
	return "cyan";
}

function resolveDisplayName(
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

export function ClineModelSelectorContent(
	props: ChoiceContext<string> & {
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
		const rows: {
			key: string;
			kind: "header" | "model" | "browse";
			label: string;
			tags: string[];
			isCurrent: boolean;
			entryIndex: number;
		}[] = [];
		let lastTier: string | null = null;
		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			if (!entry) continue;
			if (entry.kind === "model") {
				if (entry.tier !== lastTier) {
					lastTier = entry.tier;
					rows.push({
						key: `tier-${entry.tier}`,
						kind: "header",
						label: entry.tier === "recommended" ? "Recommended" : "Free",
						tags: [],
						isCurrent: false,
						entryIndex: -1,
					});
				}
				rows.push({
					key: entry.model.id,
					kind: "model",
					label: resolveDisplayName(entry.model.id, knownModels),
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
	}, [entries, knownModels, currentModel]);

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
			const entry = entries[selected];
			if (!entry) return;
			if (entry.kind === "model") {
				resolve(entry.model.id);
			} else {
				resolve(BROWSE_ALL_ACTION);
			}
			return;
		}
		const total = entries.length;
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

	return (
		<box flexDirection="column" gap={1}>
			<text>
				<strong>Choose a model</strong>
			</text>

			<ProviderRow providerName={currentProviderName} focused={onProvider} />

			<box flexDirection="column">
				{displayRows.map((row, idx) => {
					if (row.kind === "header") {
						const isFirst = idx === 0;
						return (
							<box key={row.key} paddingX={1} marginTop={isFirst ? 0 : 1}>
								<text fg="gray">{row.label}</text>
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
									isSel ? palette.textOnSelection : isGray ? "gray" : undefined
								}
							>
								{row.label}
							</text>
							{row.tags.map((t) => (
								<text
									key={t}
									fg={isSel ? palette.textOnSelection : tagColor(t)}
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

			<text fg="gray">
				↑/↓ navigate, Enter to select, Tab to change provider, Esc to go back
			</text>
		</box>
	);
}

export function ClineModelSelectorDialogContent(
	props: ChoiceContext<string> & {
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
