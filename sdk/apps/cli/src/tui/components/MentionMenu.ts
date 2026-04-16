import { Box, Text } from "ink";
import React from "react";
import type { VisibleWindow } from "./ConfigView";

function truncatePath(path: string, maxLength = 70): string {
	if (path.length <= maxLength) {
		return path;
	}
	return `...${path.slice(-(maxLength - 3))}`;
}

interface MentionMenuProps {
	query: string;
	isSearching: boolean;
	results: string[];
	selectedIndex: number;
	visibleWindow: VisibleWindow<string>;
}

export function MentionMenu({
	query,
	isSearching,
	results,
	selectedIndex,
	visibleWindow,
}: MentionMenuProps): React.ReactElement {
	return React.createElement(
		Box,
		{ flexDirection: "column", marginTop: 1, paddingX: 1 },
		isSearching
			? React.createElement(Text, { color: "gray" }, "Searching files...")
			: results.length === 0
				? React.createElement(
						Text,
						{ color: "gray" },
						query ? `No files matching "${query}"` : "Type to search files...",
					)
				: visibleWindow.items.map((path, index) => {
						const absoluteIndex = visibleWindow.startIndex + index;
						const selected = absoluteIndex === selectedIndex;
						const prefix = selected ? "❯" : " ";
						return React.createElement(
							Text,
							{
								color: selected ? "blue" : undefined,
								key: `${path}:${absoluteIndex}`,
							},
							`${prefix} ${truncatePath(path)}`,
						);
					}),
		results.length > visibleWindow.startIndex + visibleWindow.items.length
			? React.createElement(Text, { color: "gray" }, "  ▼")
			: null,
	);
}
