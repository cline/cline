// @jsxImportSource @opentui/react
import { useTerminalDimensions } from "@opentui/react";
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useMemo, useRef, useState } from "react";
import { palette } from "../../palette";
import {
	buildCommandPaletteItems,
	type CommandPaletteResult,
	filterCommandPaletteItems,
	findCommandPaletteShortcut,
} from "./command-palette-items";

export type { CommandPaletteResult } from "./command-palette-items";

function truncate(value: string, maxWidth: number): string {
	if (maxWidth <= 0) return "";
	if (value.length <= maxWidth) return value;
	if (maxWidth <= 3) return value.slice(0, maxWidth);
	return `${value.slice(0, maxWidth - 3)}...`;
}

function countWrappedLines(value: string, width: number): number {
	if (width <= 0) return 1;
	return Math.max(1, Math.ceil(value.length / width));
}

export function CommandPaletteContent(
	props: ChoiceContext<CommandPaletteResult> & {
		canForkSession: boolean;
		contentWidth: number;
	},
) {
	const { resolve, dismiss, dialogId, canForkSession, contentWidth } = props;
	const { height } = useTerminalDimensions();
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState(0);

	const allItems = useMemo(
		() =>
			buildCommandPaletteItems({
				canForkSession,
			}),
		[canForkSession],
	);
	const filtered = useMemo(
		() => filterCommandPaletteItems(allItems, query),
		[allItems, query],
	);
	const safeSelected = Math.min(selected, Math.max(0, filtered.length - 1));

	const filteredRef = useRef(filtered);
	filteredRef.current = filtered;
	const allItemsRef = useRef(allItems);
	allItemsRef.current = allItems;
	const selectedRef = useRef(safeSelected);
	selectedRef.current = safeSelected;

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			key.preventDefault();
			dismiss();
			return;
		}
		if (key.ctrl && key.name === "c") {
			key.preventDefault();
			dismiss();
			return;
		}
		const shortcut = findCommandPaletteShortcut(allItemsRef.current, key);
		if (shortcut) {
			key.preventDefault();
			resolve(shortcut.result);
			return;
		}
		if (key.name === "return" || key.name === "enter" || key.name === "tab") {
			key.preventDefault();
			const item = filteredRef.current[selectedRef.current];
			if (item) resolve(item.result);
			return;
		}
		if (key.name === "up" || (key.ctrl && key.name === "p")) {
			key.preventDefault();
			setSelected((index) =>
				filteredRef.current.length === 0
					? 0
					: index <= 0
						? filteredRef.current.length - 1
						: index - 1,
			);
			return;
		}
		if (key.name === "down" || (key.ctrl && key.name === "n")) {
			key.preventDefault();
			setSelected((index) =>
				filteredRef.current.length === 0
					? 0
					: index >= filteredRef.current.length - 1
						? 0
						: index + 1,
			);
		}
	}, dialogId);

	const shortcutWidth = 5;
	const shortcutGap = 1;
	const itemPaddingLeft = 1;
	const itemPaddingRight = 1;
	const itemContentWidth = Math.max(
		0,
		contentWidth - itemPaddingLeft - itemPaddingRight,
	);
	const descriptionWidth = itemContentWidth;
	const labelWidth = Math.max(
		0,
		itemContentWidth - shortcutGap - shortcutWidth,
	);
	const rowHeight =
		2 +
		Math.max(
			1,
			...filtered.map((item) =>
				countWrappedLines(item.description, descriptionWidth),
			),
		);
	const maxVisible = Math.max(3, Math.floor((height - 12) / rowHeight));
	const start = Math.max(
		0,
		Math.min(
			safeSelected - Math.floor(maxVisible / 2),
			Math.max(0, filtered.length - maxVisible),
		),
	);
	const visible = filtered.slice(start, start + maxVisible);

	return (
		<box flexDirection="column" width={contentWidth} gap={1}>
			<box flexDirection="row" width="100%" gap={1}>
				<text flexGrow={1}>Command Palette</text>
				<text fg="gray" flexShrink={0}>
					Ctrl+P
				</text>
			</box>

			<box
				border
				borderStyle="rounded"
				borderColor="gray"
				paddingX={1}
				width="100%"
			>
				<input
					value={query}
					onInput={(value: string) => {
						setQuery(value);
						setSelected(0);
					}}
					placeholder="Search actions..."
					flexGrow={1}
					focused
				/>
			</box>

			<box flexDirection="column">
				{visible.length === 0 ? (
					<text fg="gray">No matching commands found.</text>
				) : (
					visible.map((item, localIndex) => {
						const absoluteIndex = start + localIndex;
						const isSelected = absoluteIndex === safeSelected;
						return (
							<box key={item.id} flexDirection="column">
								<box
									flexDirection="column"
									paddingLeft={itemPaddingLeft}
									paddingRight={itemPaddingRight}
									width={contentWidth}
									overflow="hidden"
									backgroundColor={isSelected ? palette.selection : undefined}
									onMouseDown={() => resolve(item.result)}
								>
									<box flexDirection="row" height={1} width={itemContentWidth}>
										<text
											fg={isSelected ? palette.textOnSelection : "white"}
											width={labelWidth}
											flexShrink={0}
										>
											{truncate(item.label, labelWidth)}
										</text>
										<text width={shortcutGap} flexShrink={0}>
											{" "}
										</text>
										<text
											fg={isSelected ? palette.textOnSelection : "cyan"}
											width={shortcutWidth}
											flexShrink={0}
										>
											{item.shortcut}
										</text>
									</box>
									<text
										fg={isSelected ? palette.textOnSelection : "gray"}
										width={descriptionWidth}
									>
										{item.description}
									</text>
								</box>
								{localIndex < visible.length - 1 ? (
									<box
										border={["top"]}
										borderStyle="rounded"
										borderColor="gray"
										width={contentWidth}
										height={1}
									/>
								) : null}
							</box>
						);
					})
				)}
			</box>

			<text fg="gray">
				Type to search, arrow keys navigate, Enter to run, Esc to close
			</text>
		</box>
	);
}
