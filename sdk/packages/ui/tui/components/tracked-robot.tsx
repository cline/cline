import { useCallback, useRef, useState } from "react";
import { useTheme } from "../hooks/use-theme";
import { RobotAnimation } from "./robot-animation";

export function useMouseTracker() {
	const [cursor, setCursor] = useState({ x: 0, y: 0 });
	const lastUpdateRef = useRef(0);

	const onMouseMove = useCallback((event: { x: number; y: number }) => {
		const now = Date.now();
		if (now - lastUpdateRef.current < 30) return;
		lastUpdateRef.current = now;
		setCursor({ x: event.x, y: event.y });
	}, []);

	return { cursor, onMouseMove };
}

export function TrackedRobot(props: { cursorX?: number; cursorY?: number }) {
	const defaultFg = useTheme().defaultForeground;
	return (
		<box width="100%" flexShrink={1} overflow="hidden">
			<RobotAnimation
				cursorX={props.cursorX ?? 0}
				cursorY={props.cursorY ?? 0}
				defaultColor={defaultFg}
			/>
		</box>
	);
}
