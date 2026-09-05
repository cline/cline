// @jsxImportSource @opentui/react
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useState } from "react";
import { useDialogPalette } from "../../hooks/use-theme";
import type { ModelOption, ThinkingLevel } from "./model-selector";

export interface CodexSettings {
	thinking: ThinkingLevel;
	fast: boolean;
}

// An explicit Off overrides a retained effort from an earlier enabled state.
export function codexCurrentThinking(config: {
	thinking?: boolean;
	reasoningEffort?: string;
}): ThinkingLevel {
	if (config.thinking === false) return "none";
	return (
		(config.reasoningEffort as ThinkingLevel | undefined) ??
		(config.thinking ? "medium" : "none")
	);
}

export const FAST_WARNING =
	"Fast is saved for this provider and may use more quota. Availability depends on your account; faster responses are not guaranteed.";
export function codexEffortOptions(model?: ModelOption): ThinkingLevel[] {
	return [
		...new Set(
			model?.reasoningOptions?.flatMap((option) =>
				option.type === "effort"
					? option.values.filter((value): value is ThinkingLevel =>
							[
								"none",
								"minimal",
								"low",
								"medium",
								"high",
								"xhigh",
								"max",
							].includes(value ?? ""),
						)
					: [],
			) ?? [],
		),
	];
}

// Only emit reasoning fields when the user changed thinking, not on Fast-only apply.
export function codexSettingsPatch(
	current: CodexSettings,
	settings: CodexSettings,
) {
	return {
		serviceTier: settings.fast ? ("priority" as const) : undefined,
		...(settings.thinking !== current.thinking
			? {
					thinking: settings.thinking !== "none",
					reasoningEffort:
						settings.thinking === "none" ? undefined : settings.thinking,
				}
			: {}),
	};
}

export function changeCodexSetting(
	settings: CodexSettings,
	field: "thinking" | "fast",
	levels: readonly ThinkingLevel[],
	direction = 1,
): CodexSettings {
	if (field === "fast") return { ...settings, fast: !settings.fast };
	if (!levels.length) return settings;
	const index = levels.indexOf(settings.thinking);
	return {
		...settings,
		thinking:
			levels[
				index < 0
					? direction < 0
						? levels.length - 1
						: 0
					: (index + direction + levels.length) % levels.length
			]!,
	};
}

export function CodexSettingsContent(
	props: ChoiceContext<CodexSettings> & {
		modelName: string;
		model?: ModelOption;
		current: CodexSettings;
	},
) {
	const { resolve, dismiss, dialogId, modelName, current } = props;
	const levels = codexEffortOptions(props.model);
	const palette = useDialogPalette();
	const [settings, setSettings] = useState(current);
	const [selected, setSelected] = useState(0);
	const change = (row: number, direction = 1) => {
		if (row === 2) resolve(settings);
		else
			setSettings((s) =>
				changeCodexSetting(
					s,
					row === 0 ? "thinking" : "fast",
					levels,
					direction,
				),
			);
	};
	useDialogKeyboard((key) => {
		if (key.name === "escape") dismiss();
		else if (key.name === "up") setSelected((s) => (s + 2) % 3);
		else if (key.name === "down" || key.name === "tab")
			setSelected((s) => (s + 1) % 3);
		else if (key.name === "left" || key.name === "right") {
			if (selected < 2) change(selected, key.name === "left" ? -1 : 1);
		} else if (
			key.name === "return" ||
			key.name === "enter" ||
			key.name === "space"
		)
			change(selected);
	}, dialogId);
	const rows = [
		`Thinking: ${settings.thinking === "none" ? "Off" : settings.thinking}${!levels.length ? " (effort options unavailable)" : !levels.includes(settings.thinking) ? " (current; not supported by selected model)" : ""}`,
		`Fast: ${settings.fast ? "On (priority requested)" : "Off"}`,
		"Apply settings",
	];
	return (
		<box flexDirection="column" gap={1}>
			<text>Settings for {modelName}</text>
			<text fg="gray">Thinking and Fast are independent.</text>
			{rows.map((label, index) => (
				<box
					key={index}
					paddingX={1}
					backgroundColor={selected === index ? palette.selection : undefined}
					onMouseDown={() => {
						setSelected(index);
						change(index);
					}}
				>
					<text fg={selected === index ? palette.textOnSelection : undefined}>
						{selected === index ? "❯ " : "  "}
						{label}
					</text>
				</box>
			))}
			<text>{FAST_WARNING}</text>
			<text fg="gray">
				↑/↓ select, ←/→ change, Enter toggle/apply, Esc cancel
			</text>
		</box>
	);
}
