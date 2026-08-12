import { useTerminalDimensions } from "@opentui/react";
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useMemo, useRef, useState } from "react";
import type { SlashCommandRegistryEntry } from "../../commands/slash-command-registry";
import { palette } from "../../palette";
import {
	buildSkillsPickerRows,
	selectableSkillsPickerRowIndexes,
} from "./skills-picker-helpers";

export const SKILLS_MARKETPLACE_ACTION = "__skills_marketplace__";
export const SKILLS_MARKETPLACE_URL = "https://skills.sh/";

interface SkillsPickerContentProps extends ChoiceContext<string> {
	commands: SlashCommandRegistryEntry[];
}

export function SkillsPickerContent(props: SkillsPickerContentProps) {
	const { resolve, dismiss, dialogId, commands } = props;
	const { height, width } = useTerminalDimensions();
	const [filter, setFilter] = useState("");
	const [selected, setSelected] = useState(0);

	const hasFilter = filter.trim().length > 0;
	const showMarketplace = !hasFilter;
	const rows = useMemo(
		() =>
			buildSkillsPickerRows(commands, filter, {
				includeMarketplace: showMarketplace,
			}),
		[commands, filter, showMarketplace],
	);
	const selectableIndexes = useMemo(
		() => selectableSkillsPickerRowIndexes(rows),
		[rows],
	);
	const totalItems = selectableIndexes.length;
	const safeSelected = Math.min(selected, Math.max(0, totalItems - 1));
	const selectedRowIndex = selectableIndexes[safeSelected] ?? -1;
	const rowsRef = useRef(rows);
	rowsRef.current = rows;
	const selectableIndexesRef = useRef(selectableIndexes);
	selectableIndexesRef.current = selectableIndexes;
	const selectedRef = useRef(safeSelected);
	selectedRef.current = safeSelected;

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (key.name === "return" || key.name === "enter" || key.name === "tab") {
			const rowIndex = selectableIndexesRef.current[selectedRef.current] ?? -1;
			const row = rowsRef.current[rowIndex];
			if (!row) return;
			if (row.kind === "marketplace") {
				resolve(SKILLS_MARKETPLACE_ACTION);
				return;
			}
			if (row.kind === "command") {
				resolve(row.command.name);
			}
			return;
		}
		if (key.name === "up") {
			setSelected((index) => {
				const len = selectableIndexesRef.current.length;
				return len === 0 || index <= 0 ? Math.max(0, len - 1) : index - 1;
			});
			return;
		}
		if (key.name === "down") {
			setSelected((index) => {
				const len = selectableIndexesRef.current.length;
				return len === 0 || index >= len - 1 ? 0 : index + 1;
			});
		}
	}, dialogId);

	const maxVisible = Math.max(3, height - 12);
	const anchorIndex = selectedRowIndex >= 0 ? selectedRowIndex : 0;
	const start = Math.max(
		0,
		Math.min(
			anchorIndex - Math.floor(maxVisible / 2),
			Math.max(0, rows.length - maxVisible),
		),
	);
	const visibleRowIndexes = Array.from(
		{ length: Math.min(maxVisible, Math.max(0, rows.length - start)) },
		(_, index) => start + index,
	);
	const commandWidth = Math.min(36, Math.max(18, Math.floor(width * 0.32)));
	const selectedRow = rows[selectedRowIndex];
	const enterAction =
		totalItems === 0
			? undefined
			: selectedRow?.kind === "marketplace"
				? "open"
				: "insert";

	return (
		<box flexDirection="column" gap={1}>
			<box flexDirection="row" justifyContent="space-between">
				<text fg="white">
					<strong>Skills</strong>
				</text>
				<text fg="gray">esc</text>
			</box>

			<box border borderStyle="rounded" borderColor="gray" paddingX={1}>
				<input
					onInput={(value: string) => {
						setFilter(value);
						setSelected(0);
					}}
					placeholder="Search skills..."
					flexGrow={1}
					focused
				/>
			</box>

			<box flexDirection="column">
				{totalItems === 0 ? (
					<box flexDirection="column">
						<text fg="magenta">Skills</text>
						<text fg="gray">No matching skills found.</text>
					</box>
				) : (
					visibleRowIndexes.map((rowIndex) => {
						const row = rows[rowIndex];
						if (!row) return null;
						const isSelected = rowIndex === selectedRowIndex;

						if (row.kind === "header") {
							return (
								<text key={`header-${row.label}`} fg="magenta">
									{row.label}
								</text>
							);
						}

						if (row.kind === "marketplace") {
							return (
								<box
									key="skills-marketplace"
									flexDirection="row"
									backgroundColor={isSelected ? palette.selection : undefined}
									onMouseDown={() => resolve(SKILLS_MARKETPLACE_ACTION)}
									height={1}
								>
									<text fg={isSelected ? palette.textOnSelection : palette.act}>
										{isSelected ? "❯ " : "  "}
										Browse more skills at {SKILLS_MARKETPLACE_URL}
									</text>
								</box>
							);
						}

						const command = row.command;
						return (
							<box
								key={`${command.folder ?? ""}/${command.name}`}
								flexDirection="row"
								backgroundColor={isSelected ? palette.selection : undefined}
								onMouseDown={() => resolve(command.name)}
								height={1}
							>
								<text
									fg={isSelected ? palette.textOnSelection : "white"}
									width={commandWidth}
									flexShrink={0}
								>
									{command.name}
								</text>
								<text fg={isSelected ? palette.textOnSelection : "gray"}>
									{command.description}
								</text>
							</box>
						);
					})
				)}
			</box>

			{commands.length === 0 && !hasFilter && (
				<text fg="gray">
					Install skills with: <strong>npx skills add owner/repo</strong>
				</text>
			)}

			<text fg="gray">
				<em>
					Type to filter, ↑/↓ navigate
					{enterAction ? `, Enter to ${enterAction}` : ""}, Esc to close
				</em>
			</text>
		</box>
	);
}
