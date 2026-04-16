import { Box, Text } from "ink";
import React from "react";
import { truncate } from "../../utils/helpers";

export interface QueuedPromptItem {
	id: string;
	prompt: string;
	steer: boolean;
}

interface InputBoxProps {
	input: string;
	queuedPrompts: QueuedPromptItem[];
}

export function InputBox({
	input,
	queuedPrompts,
}: InputBoxProps): React.ReactElement {
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
				input,
			),
		),
	);
}
