import { type LayoutChangeEvent, Platform, Text } from "react-native";
import { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findAllByType, render } from "./__testing__/render";
import { KeyboardAvoidingContainer } from "./KeyboardAvoidingContainer";

const originalOS = Platform.OS;
afterEach(() => {
	Platform.OS = originalOS;
});

describe("Android keyboard ancestor measurement", () => {
	it("accounts for the header without counting the view's local position twice", () => {
		Platform.OS = "android";
		const mounted = render(
			<KeyboardAvoidingContainer style={{ flex: 1 }}>
				<Text>Unsent draft</Text>
			</KeyboardAvoidingContainer>,
		);
		const boundary = () =>
			findAllByType(mounted.root, "KeyboardAvoidingView")[0]!;
		let complete!: (
			x: number,
			y: number,
			width: number,
			height: number,
		) => void;
		const measureInWindow = vi.fn((callback) => {
			complete = callback;
		});
		act(() =>
			boundary().props.onLayout({
				target: { measureInWindow },
				nativeEvent: { layout: { x: 0, y: 36, width: 411, height: 720 } },
			} as unknown as LayoutChangeEvent),
		);
		act(() => complete(0, 180, 411, 720));
		// Screen-space bottom = ancestor + local y + height; with a keyboard
		// starting at 600, RN must remove 300, rather than 336 or 156.
		const ancestor = boundary().props.keyboardVerticalOffset;
		expect(ancestor + 36 + 720 - 600).toBe(300);
		expect(ancestor).toBe(144);
	});

	it("keeps the latest header/banner measurement after asynchronous layout changes", () => {
		Platform.OS = "android";
		const mounted = render(<KeyboardAvoidingContainer />);
		const boundary = () =>
			findAllByType(mounted.root, "KeyboardAvoidingView")[0]!;
		const callbacks: Array<
			(x: number, y: number, width: number, height: number) => void
		> = [];
		const event = (y: number) => ({
			target: {
				measureInWindow: (callback: (typeof callbacks)[number]) =>
					callbacks.push(callback),
			},
			nativeEvent: { layout: { x: 0, y, width: 411, height: 720 } },
		});
		act(() => boundary().props.onLayout(event(36)));
		act(() => boundary().props.onLayout(event(80)));
		act(() => callbacks[1]!(0, 210, 411, 720));
		act(() => callbacks[0]!(0, 180, 411, 720));
		expect(boundary().props.keyboardVerticalOffset).toBe(130);
	});
});
