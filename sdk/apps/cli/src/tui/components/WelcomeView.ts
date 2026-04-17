import type { AgentMode } from "@clinebot/core";
import { Box, Text } from "ink";
import React, { memo, useEffect, useState } from "react";

interface WelcomeViewProps {
	providerId: string;
	modelId: string;
	mode: AgentMode;
	mouseOffsetX: number;
	mouseOffsetY: number;
	welcomeLine?: string;
	welcomeLinePending?: boolean;
}

const CLINE_LOGO = [
	"            :::::::            ",
	"           :::::::::           ",
	"       :::::::::::::::::       ",
	"    :::::::::::::::::::::::    ",
	"   :::::::::::::::::::::::::   ",
	"  :::::::::::::::::::::::::::  ",
	"  :::::::   :::::::   :::::::  ",
	" :::::::     :::::     ::::::: ",
	"::::::::     :::::     ::::::::",
	"::::::::     :::::     ::::::::",
	" :::::::     :::::     ::::::: ",
	"  :::::::   :::::::   :::::::  ",
	"  :::::::::::::::::::::::::::  ",
	"   :::::::::::::::::::::::::   ",
	"    :::::::::::::::::::::::    ",
	"       ::::::::::::::::        ",
] as const;

function WelcomeViewComponent(props: WelcomeViewProps): React.ReactElement {
	const [showWelcomePlaceholder, setShowWelcomePlaceholder] = useState(true);
	const horizontalShift = Math.max(-4, Math.min(4, props.mouseOffsetX));
	const shiftedLogo = CLINE_LOGO.map((line) => {
		if (horizontalShift === 0) {
			return line;
		}
		if (horizontalShift > 0) {
			return `${" ".repeat(horizontalShift)}${line}`;
		}
		return line.slice(Math.abs(horizontalShift));
	});

	useEffect(() => {
		if (!props.welcomeLinePending) {
			setShowWelcomePlaceholder(true);
			return;
		}
		const interval = setInterval(() => {
			setShowWelcomePlaceholder((current) => !current);
		}, 450);
		return () => {
			clearInterval(interval);
		};
	}, [props.welcomeLinePending]);

	return React.createElement(
		Box,
		{ flexDirection: "column", alignItems: "center", marginBottom: 1 },
		React.createElement(Text, { key: "top-pad:0" }, " "),
		React.createElement(Text, { key: "top-pad:1" }, " "),
		React.createElement(
			Box,
			{ flexDirection: "column", marginBottom: 1 },
			shiftedLogo.map((line, index) =>
				React.createElement(
					Text,
					{ color: "white", key: `${index}:${line}` },
					line,
				),
			),
		),
		React.createElement(
			Box,
			{ marginBottom: 1 },
			React.createElement(
				Text,
				{ bold: true, color: "white" },
				"What can I do for you?",
			),
		),
		props.welcomeLine
			? React.createElement(
					Box,
					{ marginBottom: 1 },
					React.createElement(Text, { color: "gray" }, props.welcomeLine),
				)
			: props.welcomeLinePending
				? React.createElement(
						Box,
						{ marginBottom: 1 },
						React.createElement(
							Text,
							{ color: showWelcomePlaceholder ? "gray" : "blackBright" },
							"Loading account details...",
						),
					)
				: null,
	);
}

export const WelcomeView = memo(WelcomeViewComponent);
