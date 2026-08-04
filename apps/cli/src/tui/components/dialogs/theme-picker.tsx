import { useTerminalDimensions } from "@opentui/react";
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useEffect, useRef, useState } from "react";
import { useThemeController } from "../../hooks/use-theme";
import { palette } from "../../palette";
import { getThemeSwatchColors, THEMES } from "../../themes";

const SWATCH_BLOCK = "\u25a0";

export function ThemePickerContent(props: ChoiceContext<string>) {
	const { resolve, dismiss, dialogId } = props;
	const { height } = useTerminalDimensions();
	const controller = useThemeController();
	const [selected, setSelected] = useState(() => {
		const index = THEMES.findIndex(
			(theme) => theme.id === controller.selectedThemeId,
		);
		return index >= 0 ? index : 0;
	});

	const selectedRef = useRef(selected);
	selectedRef.current = selected;
	const controllerRef = useRef(controller);
	controllerRef.current = controller;

	// Live preview: moving the selection repaints the whole TUI with the
	// highlighted theme so users see exactly what they would get.
	useEffect(() => {
		const theme = THEMES[selected];
		if (theme) {
			controllerRef.current.previewThemeId(theme.id);
		}
	}, [selected]);

	// Clear any dangling preview when the dialog closes without a confirm
	// (escape, backdrop click, dialog replaced). setThemeId already clears the
	// preview on confirm, so this is a no-op in that path.
	useEffect(() => {
		return () => {
			controllerRef.current.previewThemeId(null);
		};
	}, []);

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (key.name === "return" || key.name === "enter" || key.name === "tab") {
			const theme = THEMES[selectedRef.current];
			if (theme) {
				controllerRef.current.setThemeId(theme.id);
				resolve(theme.id);
			}
			return;
		}
		if (key.name === "up") {
			setSelected((index) => (index <= 0 ? THEMES.length - 1 : index - 1));
			return;
		}
		if (key.name === "down") {
			setSelected((index) => (index >= THEMES.length - 1 ? 0 : index + 1));
		}
	}, dialogId);

	const maxVisible = Math.max(3, height - 10);
	const start = Math.max(
		0,
		Math.min(
			selected - Math.floor(maxVisible / 2),
			Math.max(0, THEMES.length - maxVisible),
		),
	);
	const visibleThemes = THEMES.slice(start, start + maxVisible);
	// Selection prefix (2 cells) + longest label + separating gap.
	const labelWidth = Math.max(...THEMES.map((theme) => theme.label.length)) + 4;

	return (
		<box flexDirection="column" gap={1}>
			<box flexDirection="row" justifyContent="space-between">
				<text fg="white">
					<strong>Theme</strong>
				</text>
				<text fg="gray">esc</text>
			</box>

			<box flexDirection="column">
				{visibleThemes.map((theme, i) => {
					const absoluteIndex = start + i;
					const isSelected = absoluteIndex === selected;
					const isCurrent = theme.id === controller.selectedThemeId;
					const swatches = getThemeSwatchColors(theme);
					return (
						<box
							key={theme.id}
							flexDirection="row"
							backgroundColor={isSelected ? palette.selection : undefined}
							onMouseDown={() => {
								setSelected(absoluteIndex);
								controllerRef.current.setThemeId(theme.id);
								resolve(theme.id);
							}}
							height={1}
						>
							<text
								fg={isSelected ? palette.textOnSelection : "white"}
								width={labelWidth}
								flexShrink={0}
							>
								{isSelected ? "\u276f " : "  "}
								{theme.label}
							</text>
							<text flexShrink={0}>
								{swatches.map((color, swatchIndex) => (
									<span
										// biome-ignore lint/suspicious/noArrayIndexKey: fixed-size color strip
										key={swatchIndex}
										fg={color}
									>
										{SWATCH_BLOCK}
									</span>
								))}
							</text>
							<text fg={isSelected ? palette.textOnSelection : "gray"}>
								{"  "}
								{theme.description}
								{isCurrent ? " (current)" : ""}
							</text>
						</box>
					);
				})}
			</box>

			<text fg="gray">
				<em>{"\u2191/\u2193 preview, Enter to apply, Esc to cancel"}</em>
			</text>
		</box>
	);
}
