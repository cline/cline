import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";
import { truncate } from "../../utils/helpers";

export interface QueuedPromptItem {
	id: string;
	prompt: string;
	steer: boolean;
}

interface InputBoxProps {
	input: string;
	cursorIndex: number;
	queuedPrompts: QueuedPromptItem[];
}

export function InputBox({
	input,
	cursorIndex,
	queuedPrompts,
}: InputBoxProps): React.ReactElement {
	const [showCursor, setShowCursor] = useState(true);

	useEffect(() => {
		setShowCursor(true);
		const timer = setInterval(() => {
			setShowCursor((current) => !current);
		}, 530);
		return () => clearInterval(timer);
	}, []);

	const clampedCursorIndex = Math.max(0, Math.min(cursorIndex, input.length));
	const beforeCursor = input.slice(0, clampedCursorIndex);
	const cursorCharacter = input[clampedCursorIndex] ?? " ";
	const afterCursor = input.slice(clampedCursorIndex + 1);

	return React.createElement(
		Box,
		{ flexDirection: "column" },
		queuedPrompts.length > 0
			? React.createElement(
					Box,
					{
						borderStyle: "round",
						paddingX: 1,
						paddingY: 0,
						marginBottom: 1,
						flexDirection: "column",
					},
					React.createElement(
						Text,
						{ color: "gray" },
						"Queued for upcoming turns",
					),
					React.createElement(
						Text,
						{ color: "gray" },
						"Enter queues while running. Ctrl+S steers the next turn.",
					),
					...queuedPrompts.map((item, index) =>
						React.createElement(
							Text,
							{
								key: item.id,
								color: item.steer ? "yellow" : undefined,
							},
							item.steer
								? `Steer: ${truncate(item.prompt, 100)}`
								: `Queue ${index + 1}: ${truncate(item.prompt, 100)}`,
						),
					),
				)
			: null,
		React.createElement(
			Box,
			{ borderStyle: "round", paddingX: 1 },
			React.createElement(
				Text,
				null,
				React.createElement(Text, { color: "green" }, "> "),
				beforeCursor,
				showCursor
					? React.createElement(
							Text,
							{
								backgroundColor: "green",
								color: "black",
							},
							cursorCharacter,
						)
					: React.createElement(Text, null, cursorCharacter),
				afterCursor,
			),
		),
	);
}
