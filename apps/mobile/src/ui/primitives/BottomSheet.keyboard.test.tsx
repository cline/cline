import { useAnimatedKeyboard } from "@gorhom/bottom-sheet/src/hooks/useAnimatedKeyboard";
import type { KeyboardEvent, KeyboardEventName } from "react-native";
import { act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/ui/__testing__/render";

const native = vi.hoisted(() => ({
	screenHeight: 874,
	listeners: new Map<KeyboardEventName, (event: KeyboardEvent) => void>(),
}));

vi.mock("react-native", () => ({
	Dimensions: { get: () => ({ height: native.screenHeight }) },
	Keyboard: {
		addListener(
			name: KeyboardEventName,
			listener: (event: KeyboardEvent) => void,
		) {
			native.listeners.set(name, listener);
			return { remove: () => native.listeners.delete(name) };
		},
	},
	Platform: {
		OS: "ios",
		select: <T,>(options: { ios?: T; default?: T }) =>
			options.ios ?? options.default,
	},
}));

vi.mock("react-native-reanimated", async () => {
	const { useMemo, useRef } = await import("react");
	return {
		Easing: { exp: (value: number) => value, out: (easing: unknown) => easing },
		runOnUI: <T,>(worklet: T) => worklet,
		useAnimatedReaction: () => {},
		useSharedValue: <T,>(initial: T) => {
			const current = useRef(initial);
			return useMemo(
				() => ({
					get value() {
						return current.current;
					},
					get: () => current.current,
					set(update: T | ((value: T) => T)) {
						current.current =
							update instanceof Function ? update(current.current) : update;
					},
				}),
				[],
			);
		},
	};
});

beforeEach(() => native.listeners.clear());

describe("bottom-sheet keyboard geometry after rotation", () => {
	it.each([
		{ from: 874, to: 402, keyboard: 215 },
		{ from: 402, to: 874, keyboard: 336 },
	])("uses the current screen height after rotating from $from to $to", ({
		from,
		to,
		keyboard,
	}) => {
		native.screenHeight = from;
		let keyboardState:
			| ReturnType<typeof useAnimatedKeyboard>["state"]
			| undefined;
		function Harness() {
			keyboardState = useAnimatedKeyboard().state;
			return null;
		}
		const app = render(<Harness />);
		if (!keyboardState) throw new Error("Keyboard hook did not mount");
		keyboardState.set((state) => ({ ...state, target: 1 }));
		native.screenHeight = to;
		const coordinates = {
			height: keyboard,
			screenY: to - keyboard,
			screenX: 0,
			width: 402,
		};
		const show = native.listeners.get("keyboardWillShow");
		if (!show) throw new Error("Keyboard show listener was not installed");
		act(() =>
			show({
				startCoordinates: coordinates,
				endCoordinates: coordinates,
				duration: 250,
				easing: "keyboard",
				isEventFromThisApp: true,
			}),
		);
		const actualHeight = keyboardState.get().height;
		app.unmount();
		expect(actualHeight).toBe(keyboard);
	});
});
