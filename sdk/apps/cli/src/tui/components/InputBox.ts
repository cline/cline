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
	cursor: number;
	queuedPrompts: QueuedPromptItem[];
}

function renderInputWithCursor(
	input: string,
	cursor: number,
	cursorVisible: boolean,
): React.ReactNode[] {
	const safeCursor = Math.max(0, Math.min(cursor, input.length));
	const before = input.slice(0, safeCursor);
	const currentChar = input[safeCursor] ?? " ";
	const after = input.slice(safeCursor + (safeCursor < input.length ? 1 : 0));
	const parts: React.ReactNode[] = [];

	if (before) {
		parts.push(React.createElement(Text, { key: "before" }, before));
	}

	parts.push(
		cursorVisible
			? React.createElement(Text, { key: "cursor", inverse: true }, currentChar)
			: React.createElement(Text, { key: "cursor" }, currentChar),
	);

	if (after) {
		parts.push(React.createElement(Text, { key: "after" }, after));
	}

	return parts;
}

export function InputBox({
	input,
	cursor,
	queuedPrompts,
}: InputBoxProps): React.ReactElement {
	const [cursorVisible, setCursorVisible] = useState(true);

	useEffect(() => {
		setCursorVisible(true);
		const interval = setInterval(() => {
			setCursorVisible((current) => !current);
		}, 450);
		const timeout = setTimeout(() => {
			clearInterval(interval);
			setCursorVisible(true);
		}, 1200);
		return () => {
			clearInterval(interval);
			clearTimeout(timeout);
		};
	}, []);

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
				...renderInputWithCursor(input, cursor, cursorVisible),
			),
		),
	);
}
