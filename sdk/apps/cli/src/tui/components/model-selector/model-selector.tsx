// @jsxImportSource @opentui/react
import type { Llms } from "@clinebot/core";
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useMemo, useState } from "react";
import { palette } from "../../palette";
import { ProviderRow } from "./provider-row";

export interface ModelOption {
	key: string;
	name: string;
	contextWindow?: number;
	family?: string;
	supportsReasoning: boolean;
}

const MAX_VISIBLE = 10;

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

function fuzzyScore(model: ModelOption, query: string): number {
	const name = model.name.toLowerCase();
	const key = model.key.toLowerCase();
	const nName = normalize(name);
	const nKey = normalize(key);
	const nQuery = normalize(query);
	if (nName === nQuery || nKey === nQuery) return 100;
	if (nName.startsWith(nQuery)) return 90;
	if (nKey.startsWith(nQuery)) return 85;
	if (nName.includes(nQuery)) return 70;
	if (nKey.includes(nQuery)) return 65;
	const family = model.family?.toLowerCase();
	if (family && normalize(family).includes(nQuery)) return 50;
	if (fuzzyMatch(nName, nQuery)) return 30;
	if (fuzzyMatch(nKey, nQuery)) return 25;
	return 0;
}

function formatContextWindow(tokens: number): string {
	if (tokens >= 1_000_000)
		return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
	if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
	return String(tokens);
}

// -- Model selector dialog content --

export const CHANGE_PROVIDER_ACTION = "__change_provider__";

export function ModelSelectorContent(
	props: ChoiceContext<string> & {
		currentModel: string;
		currentProviderName: string;
		models: ModelOption[];
	},
) {
	const {
		resolve,
		dismiss,
		dialogId,
		currentModel,
		currentProviderName,
		models,
	} = props;
	const [search, setSearch] = useState("");
	const [selected, setSelected] = useState(() => {
		const idx = models.findIndex((m) => m.key === currentModel);
		return idx >= 0 ? idx : 0;
	});
	const [onProvider, setOnProvider] = useState(false);

	const filtered = useMemo(() => {
		if (!search) return models;
		const q = search.toLowerCase();
		const scored = models
			.map((m) => ({ model: m, score: fuzzyScore(m, q) }))
			.filter((r) => r.score > 0);
		scored.sort((a, b) => b.score - a.score);
		return scored.map((r) => r.model);
	}, [models, search]);

	const safeSelected = Math.min(selected, Math.max(0, filtered.length - 1));

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (key.name === "return" || key.name === "enter") {
			if (onProvider) {
				resolve(CHANGE_PROVIDER_ACTION);
				return;
			}
			const model = filtered[safeSelected];
			if (model) resolve(model.key);
			return;
		}
		if (key.name === "tab") {
			if (onProvider) {
				setOnProvider(false);
			} else {
				setOnProvider(true);
			}
			return;
		}
		if (key.name === "up" || (key.ctrl && key.name === "p")) {
			if (!onProvider) {
				setSelected((s) => (s <= 0 ? filtered.length - 1 : s - 1));
			}
			return;
		}
		if (key.name === "down" || (key.ctrl && key.name === "n")) {
			if (!onProvider) {
				setSelected((s) => (s >= filtered.length - 1 ? 0 : s + 1));
			}
			return;
		}
	}, dialogId);

	return (
		<box flexDirection="column" gap={1}>
			<text>Select Model</text>

			<ProviderRow providerName={currentProviderName} focused={onProvider} />

			<box border borderStyle="rounded" borderColor="gray" paddingX={1}>
				<input
					onInput={(v: string) => {
						setSearch(v);
						setSelected(0);
						setOnProvider(false);
					}}
					placeholder="Search models..."
					flexGrow={1}
					focused
				/>
			</box>

			<ModelList
				items={filtered}
				selected={safeSelected}
				dimmed={onProvider}
				currentModel={currentModel}
				onSelect={resolve}
			/>

			<text fg="gray">
				Type to search, ↑/↓ navigate, Enter to select, Tab to change provider,
				Esc to close
			</text>
		</box>
	);
}

// -- Thinking level dialog content --

export type ThinkingLevel = "none" | "low" | "medium" | "high" | "xhigh";

const THINKING_LEVELS: { value: ThinkingLevel; label: string; desc: string }[] =
	[
		{ value: "none", label: "Off", desc: "No extended thinking" },
		{ value: "low", label: "Low", desc: "Minimal reasoning" },
		{ value: "medium", label: "Medium", desc: "Balanced reasoning" },
		{ value: "high", label: "High", desc: "Deep reasoning" },
		{ value: "xhigh", label: "Extra High", desc: "Maximum reasoning" },
	];

export function ThinkingLevelContent(
	props: ChoiceContext<ThinkingLevel> & {
		modelName: string;
		currentLevel: ThinkingLevel;
	},
) {
	const { resolve, dismiss, dialogId, modelName, currentLevel } = props;
	const [selected, setSelected] = useState(() => {
		const idx = THINKING_LEVELS.findIndex((l) => l.value === currentLevel);
		return idx >= 0 ? idx : 0;
	});

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (key.name === "return" || key.name === "enter") {
			const level = THINKING_LEVELS[selected];
			if (level) resolve(level.value);
			return;
		}
		if (key.name === "up" || (key.ctrl && key.name === "p")) {
			setSelected((s) => (s <= 0 ? THINKING_LEVELS.length - 1 : s - 1));
			return;
		}
		if (key.name === "down" || (key.ctrl && key.name === "n")) {
			setSelected((s) => (s >= THINKING_LEVELS.length - 1 ? 0 : s + 1));
			return;
		}
	}, dialogId);

	return (
		<box flexDirection="column" gap={1}>
			<text>Thinking Level for {modelName}</text>

			<box flexDirection="column">
				{THINKING_LEVELS.map((level, i) => (
					<box
						key={level.value}
						paddingX={1}
						flexDirection="row"
						gap={1}
						justifyContent="space-between"
						backgroundColor={i === selected ? palette.selection : undefined}
						onMouseDown={() => resolve(level.value)}
					>
						<box flexDirection="row" gap={1} flexShrink={0}>
							<text
								fg={i === selected ? palette.textOnSelection : "gray"}
								flexShrink={0}
							>
								{i === selected ? "\u276f" : " "}
							</text>
							<text fg={i === selected ? palette.textOnSelection : undefined}>
								{level.label}
							</text>
						</box>
						<box flexDirection="row" gap={1} flexShrink={1}>
							<text fg={i === selected ? palette.textOnSelection : "gray"}>
								{level.desc}
							</text>
							{level.value === currentLevel && (
								<text
									fg={
										i === selected ? palette.textOnSelection : palette.success
									}
									flexShrink={0}
								>
									(current)
								</text>
							)}
						</box>
					</box>
				))}
			</box>

			<text fg="gray">↑/↓ navigate, Enter to select, Esc to go back</text>
		</box>
	);
}

// -- Windowed list --

function ModelList(props: {
	items: ModelOption[];
	selected: number;
	dimmed?: boolean;
	currentModel: string;
	onSelect: (key: string) => void;
}) {
	const { items, selected, dimmed, currentModel, onSelect } = props;

	if (items.length === 0) {
		return (
			<text fg="gray" paddingX={1}>
				No models match
			</text>
		);
	}

	if (items.length <= MAX_VISIBLE) {
		return (
			<box flexDirection="column">
				{items.map((m, i) => (
					<ModelRow
						key={m.key}
						model={m}
						isSelected={i === selected}
						dimmed={dimmed}
						isCurrent={m.key === currentModel}
						onSelect={onSelect}
					/>
				))}
			</box>
		);
	}

	const halfWindow = Math.floor(MAX_VISIBLE / 2);
	let start = Math.max(0, selected - halfWindow);
	if (start + MAX_VISIBLE > items.length) {
		start = items.length - MAX_VISIBLE;
	}

	const showAbove = start > 0;
	const showBelow = start + MAX_VISIBLE < items.length;

	const itemSlots = MAX_VISIBLE - (showAbove ? 1 : 0) - (showBelow ? 1 : 0);
	const itemStart = showAbove ? start + 1 : start;
	const visible = items.slice(itemStart, itemStart + itemSlots);

	const aboveCount = itemStart;
	const belowCount = items.length - (itemStart + itemSlots);

	return (
		<box flexDirection="column">
			{showAbove && (
				<box paddingX={1} justifyContent="center">
					<text fg="gray">
						{"\u25b2"} {aboveCount} more
					</text>
				</box>
			)}
			{visible.map((m, i) => (
				<ModelRow
					key={m.key}
					model={m}
					isSelected={itemStart + i === selected}
					dimmed={dimmed}
					isCurrent={m.key === currentModel}
					onSelect={onSelect}
				/>
			))}
			{showBelow && (
				<box paddingX={1} justifyContent="center">
					<text fg="gray">
						{"\u25bc"} {belowCount} more
					</text>
				</box>
			)}
		</box>
	);
}

function ModelRow(props: {
	model: ModelOption;
	isSelected: boolean;
	dimmed?: boolean;
	isCurrent: boolean;
	onSelect: (key: string) => void;
}) {
	const { model, isSelected, dimmed, isCurrent, onSelect } = props;
	const active = isSelected && !dimmed;
	const bg = active
		? palette.selection
		: isSelected && dimmed
			? "gray"
			: undefined;
	return (
		<box
			paddingX={1}
			flexDirection="row"
			gap={1}
			backgroundColor={bg}
			onMouseDown={() => onSelect(model.key)}
			overflow="hidden"
			height={1}
		>
			<text fg={isSelected ? palette.textOnSelection : "gray"} flexShrink={0}>
				{isSelected ? "\u276f" : " "}
			</text>
			<text fg={isSelected ? palette.textOnSelection : undefined}>
				{model.name}
			</text>
			{model.contextWindow && (
				<text fg={isSelected ? palette.textOnSelection : "gray"} flexShrink={0}>
					{formatContextWindow(model.contextWindow)}
				</text>
			)}
			{isCurrent && (
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

// -- Build model options from catalog --

export function buildModelOptions(
	knownModels?: Record<string, Llms.ModelInfo>,
): ModelOption[] {
	if (!knownModels) return [];
	return Object.entries(knownModels)
		.map(([key, info]) => ({
			key,
			name: info.name ?? key,
			contextWindow: info.contextWindow,
			family: info.family,
			supportsReasoning: info.capabilities?.includes("reasoning") ?? false,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}
