import { useTerminalDimensions } from "@opentui/react";
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useMemo, useRef, useState } from "react";
import type { SlashCommandRegistryEntry } from "../../commands/slash-command-registry";
import { palette } from "../../palette";

export const SKILLS_MARKETPLACE_ACTION = "__skills_marketplace__";
export const SKILLS_MARKETPLACE_URL = "https://skills.sh/";

interface SkillsPickerContentProps extends ChoiceContext<string> {
	commands: SlashCommandRegistryEntry[];
}

function matchesFilter(
	command: SlashCommandRegistryEntry,
	filter: string,
): boolean {
	const query = filter.trim().toLowerCase();
	if (!query) return true;
	return (
		command.name.toLowerCase().includes(query) ||
		command.description.toLowerCase().includes(query)
	);
}

export function SkillsPickerContent(props: SkillsPickerContentProps) {
	const { resolve, dismiss, dialogId, commands } = props;
	const { height, width } = useTerminalDimensions();
	const [filter, setFilter] = useState("");
	const [selected, setSelected] = useState(0);

	const filtered = useMemo(
		() => commands.filter((command) => matchesFilter(command, filter)),
		[commands, filter],
	);
	const hasFilter = filter.trim().length > 0;
	const showMarketplace = !hasFilter;
	const totalItems = filtered.length + (showMarketplace ? 1 : 0);
	const marketplaceIndex = filtered.length;
	const safeSelected = Math.min(selected, Math.max(0, totalItems - 1));
	const filteredRef = useRef(filtered);
	filteredRef.current = filtered;
	const selectedRef = useRef(safeSelected);
	selectedRef.current = safeSelected;
	const totalItemsRef = useRef(totalItems);
	totalItemsRef.current = totalItems;
	const marketplaceIndexRef = useRef(marketplaceIndex);
	marketplaceIndexRef.current = marketplaceIndex;
	const showMarketplaceRef = useRef(showMarketplace);
	showMarketplaceRef.current = showMarketplace;

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (key.name === "return" || key.name === "enter" || key.name === "tab") {
			if (
				showMarketplaceRef.current &&
				selectedRef.current === marketplaceIndexRef.current
			) {
				resolve(SKILLS_MARKETPLACE_ACTION);
				return;
			}
			const command = filteredRef.current[selectedRef.current];
			if (command) resolve(command.name);
			return;
		}
		if (key.name === "up") {
			setSelected((index) => {
				const len = totalItemsRef.current;
				return len === 0 || index <= 0 ? Math.max(0, len - 1) : index - 1;
			});
			return;
		}
		if (key.name === "down") {
			setSelected((index) => {
				const len = totalItemsRef.current;
				return len === 0 || index >= len - 1 ? 0 : index + 1;
			});
		}
	}, dialogId);

	const maxVisible = Math.max(3, height - 12);
	const start = Math.max(
		0,
		Math.min(
			safeSelected - Math.floor(maxVisible / 2),
			Math.max(0, totalItems - maxVisible),
		),
	);
	const visibleItems = Array.from(
		{ length: Math.min(maxVisible, Math.max(0, totalItems - start)) },
		(_, index) => start + index,
	);
	const commandWidth = Math.min(36, Math.max(18, Math.floor(width * 0.32)));
	const enterAction =
		totalItems === 0
			? undefined
			: safeSelected === marketplaceIndex && showMarketplace
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
				<text fg="magenta">Skills</text>

				{totalItems === 0 ? (
					<box flexDirection="column">
						<text fg="gray">No matching skills found.</text>
					</box>
				) : (
					visibleItems.map((absoluteIndex) => {
						const isSelected = absoluteIndex === safeSelected;
						if (showMarketplace && absoluteIndex === marketplaceIndex) {
							return (
								<box
									key="skills-marketplace"
									flexDirection="row"
									backgroundColor={isSelected ? palette.selection : undefined}
									onMouseDown={() => resolve(SKILLS_MARKETPLACE_ACTION)}
									height={1}
								>
									<text fg={isSelected ? palette.textOnSelection : "cyan"}>
										{isSelected ? "❯ " : "  "}
										Browse more skills at {SKILLS_MARKETPLACE_URL}
									</text>
								</box>
							);
						}

						const command = filtered[absoluteIndex];
						if (!command) return null;
						return (
							<box
								key={command.name}
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
