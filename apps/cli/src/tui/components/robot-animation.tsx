import { useTerminalDimensions } from "@opentui/react";
import { useEffect, useState } from "react";
import { type CroppedFrame, FRAMES } from "./robot-frames";

const FRAME_STRAIGHT = 0;
const FRAME_BOTTOM_LEFT = 64;
const FRAME_BOTTOM_CENTER = 96;
const FRAME_BOTTOM_RIGHT = 128;

const ROBOT_HEIGHT = 12;

function buildTheme(defaultColor: string): Record<string, string> {
	return {
		black: defaultColor,
		whiteBright: defaultColor,
		gray: defaultColor,
	};
}

function getColor(key: string, theme: Record<string, string>): string {
	return theme[key] || key;
}

interface ColorSegment {
	text: string;
	fg: string;
}

function buildRowSegments(
	row: string,
	rowIdx: number,
	colors: Record<string, string>,
	defaultColor: string,
	theme: Record<string, string>,
): ColorSegment[] {
	const segments: ColorSegment[] = [];
	let currentFg = defaultColor;
	let currentText = "";

	for (let col = 0; col < row.length; col++) {
		const key = `${col},${rowIdx}`;
		const fg = colors[key] ? getColor(colors[key], theme) : defaultColor;
		if (fg !== currentFg) {
			if (currentText) segments.push({ text: currentText, fg: currentFg });
			currentFg = fg;
			currentText = row[col];
		} else {
			currentText += row[col];
		}
	}
	if (currentText) segments.push({ text: currentText, fg: currentFg });
	return segments;
}

function RobotFrame(props: { frame: CroppedFrame; defaultColor: string }) {
	const { frame, defaultColor } = props;
	const theme = buildTheme(defaultColor);
	return (
		<box flexDirection="column">
			{frame.rows.map((row, rowIdx) => {
				const segments = buildRowSegments(
					row,
					rowIdx,
					frame.colors,
					defaultColor,
					theme,
				);
				return (
					// biome-ignore lint/suspicious/noArrayIndexKey: static animation frame with fixed row order
					<text key={`row-${rowIdx}`}>
						{segments.map((seg, j) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static animation frame with fixed row order
							<span key={`seg-${rowIdx}-${j}`} fg={seg.fg}>
								{seg.text}
							</span>
						))}
					</text>
				);
			})}
		</box>
	);
}

export function RobotAnimation(props: {
	cursorX: number;
	cursorY: number;
	defaultColor?: string;
}) {
	const [frameIndex, setFrameIndex] = useState(FRAME_STRAIGHT);
	const [targetFrame, setTargetFrame] = useState(FRAME_STRAIGHT);
	const { width, height } = useTerminalDimensions();

	const faceX = Math.floor(width / 2);
	const trackStartY = Math.floor(height / 2) - Math.floor(ROBOT_HEIGHT / 2);

	useEffect(() => {
		const dx = props.cursorX - faceX;
		const dy = props.cursorY - trackStartY;

		if (dy < 0) {
			setTargetFrame(FRAME_STRAIGHT);
			return;
		}

		const maxTrackY = height - trackStartY;
		if (dy > maxTrackY) {
			setTargetFrame(FRAME_STRAIGHT);
			return;
		}

		const maxOffset = 40;
		const clampedDx = Math.max(-maxOffset, Math.min(maxOffset, dx));
		const normalized = clampedDx / maxOffset;

		let target: number;
		if (normalized <= 0) {
			target = Math.round(
				FRAME_BOTTOM_LEFT +
					(1 + normalized) * (FRAME_BOTTOM_CENTER - FRAME_BOTTOM_LEFT),
			);
		} else {
			target = Math.round(
				FRAME_BOTTOM_CENTER +
					normalized * (FRAME_BOTTOM_RIGHT - FRAME_BOTTOM_CENTER),
			);
		}

		setTargetFrame(target);
	}, [props.cursorX, props.cursorY, faceX, trackStartY, height]);

	useEffect(() => {
		const interval = setInterval(() => {
			setFrameIndex((current) => {
				if (current === targetFrame) return current;
				const diff = targetFrame - current;
				const step =
					Math.sign(diff) * Math.max(Math.abs(Math.round(diff * 0.5)), 1);
				const next = current + step;
				if (
					(diff > 0 && next > targetFrame) ||
					(diff < 0 && next < targetFrame)
				) {
					return targetFrame;
				}
				return next;
			});
		}, 12);

		return () => clearInterval(interval);
	}, [targetFrame]);

	const safeIndex = Math.max(0, Math.min(frameIndex, FRAMES.length - 1));
	const frame = FRAMES[safeIndex];
	if (!frame) return null;

	return (
		<box flexDirection="column" alignItems="center" width="100%">
			<RobotFrame frame={frame} defaultColor={props.defaultColor ?? "white"} />
		</box>
	);
}
