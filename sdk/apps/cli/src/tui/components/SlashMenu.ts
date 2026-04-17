import { Box, Text } from "ink";
import React from "react";
import type { InteractiveSlashCommand } from "../interactive-welcome";
import type { VisibleWindow } from "./ConfigView";

interface SlashMenuProps {
	query: string;
	commands: InteractiveSlashCommand[];
	selectedIndex: number;
	visibleWindow: VisibleWindow<InteractiveSlashCommand>;
}

export function SlashMenu({
	query,
	commands,
	selectedIndex,
	visibleWindow,
}: SlashMenuProps): React.ReactElement {
	return React.createElement(
		Box,
		{ flexDirection: "column", marginTop: 1, paddingX: 1 },
		commands.length === 0
			? React.createElement(
					Text,
					{ color: "gray" },
					query
						? `No commands matching "/${query}"`
						: "No slash commands available",
				)
			: visibleWindow.items.map((command, index) => {
					const absoluteIndex = visibleWindow.startIndex + index;
					const selected = absoluteIndex === selectedIndex;
					const prefix = selected ? "❯" : " ";
					const summary = command.description
						? `${prefix} /${command.name} - ${command.description}`
						: `${prefix} /${command.name}`;
					return React.createElement(
						Text,
						{
							color: selected ? "blue" : undefined,
							key: `${command.name}:${absoluteIndex}`,
						},
						summary,
					);
				}),
		commands.length > visibleWindow.startIndex + visibleWindow.items.length
			? React.createElement(Text, { color: "gray" }, "  ▼")
			: null,
	);
}
