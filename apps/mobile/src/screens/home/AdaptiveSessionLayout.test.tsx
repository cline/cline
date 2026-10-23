import { useEffect, useState } from "react";
import * as Native from "react-native";
import { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@/ui/__testing__/render";
import {
	AdaptiveSessionLayout,
	isWideSessionLayout,
	useAdaptiveSessionLayout,
} from "./AdaptiveSessionLayout";

afterEach(() => vi.restoreAllMocks());

describe("adaptive session layout", () => {
	it.each([
		[874, false],
		[919, false],
		[920, true],
		[921, true],
	])("uses the usable window boundary at %s", (width, wide) => {
		expect(isWideSessionLayout(width)).toBe(wide);
		expect(isWideSessionLayout(width + 31 + 17, 31, 17)).toBe(wide);
	});

	it("preserves mounted content and draft through resize and collapse without dismissing the keyboard", () => {
		let width = 390;
		vi.spyOn(Native, "useWindowDimensions").mockImplementation(() => ({
			width,
			height: 844,
			scale: 2,
			fontScale: 1,
		}));
		const dismiss = vi.spyOn(Native.Keyboard, "dismiss");
		const mounted = vi.fn();
		const unmounted = vi.fn();
		let state!: ReturnType<typeof useAdaptiveSessionLayout>;
		let setDraft!: (draft: string) => void;
		function Content() {
			const [draft, update] = useState("");
			setDraft = update;
			useEffect(() => {
				mounted();
				return unmounted;
			}, []);
			return <Native.Text>{draft}</Native.Text>;
		}
		function Harness() {
			state = useAdaptiveSessionLayout();
			return (
				<AdaptiveSessionLayout
					inlineSidebar={state.wide && state.visible}
					sidebar={<Native.Text>Sessions</Native.Text>}
				>
					<Content />
				</AdaptiveSessionLayout>
			);
		}
		const result = render(<Harness />);
		act(() => setDraft("Unsent draft"));
		act(() => state.open());
		expect(state.visible).toBe(true);
		act(() => {
			width = 920;
			result.renderer.update(<Harness />);
		});
		expect(state.wide && state.visible).toBe(true);
		act(() => state.close());
		expect(state.visible).toBe(false);
		act(() => state.open());
		act(() => {
			width = 390;
			result.renderer.update(<Harness />);
		});
		expect(state.visible).toBe(false);
		expect(
			result.root
				.findAll((node) => node.type === "Text")
				.some((node) => node.props.children === "Unsent draft"),
		).toBe(true);
		expect(mounted).toHaveBeenCalledOnce();
		expect(unmounted).not.toHaveBeenCalled();
		expect(dismiss).not.toHaveBeenCalled();
		result.unmount();
	});
});

it("opens session history on a right swipe without replacing the current content or draft", () => {
	let state!: ReturnType<typeof useAdaptiveSessionLayout>;
	let setDraft!: (value: string) => void;
	const mounts = vi.fn();
	function Draft() {
		const [text, update] = useState("");
		setDraft = update;
		useEffect(mounts, []);
		return <Native.Text>{text}</Native.Text>;
	}
	function Harness() {
		state = useAdaptiveSessionLayout();
		return (
			<AdaptiveSessionLayout
				inlineSidebar={false}
				onOpenSidebar={state.open}
				sidebar={null}
			>
				<Draft />
			</AdaptiveSessionLayout>
		);
	}
	const screen = render(<Harness />);
	act(() => setDraft("Keep editing this session"));
	const detector = screen.root.find((node) => node.type === "GestureDetector");
	act(() =>
		detector.props.gesture.onEndCallback({ translationX: 12, velocityX: 0 }),
	);
	expect(state.visible).toBe(false);
	act(() =>
		detector.props.gesture.onEndCallback({ translationX: 90, velocityX: 500 }),
	);
	expect(state.visible).toBe(true);
	expect(
		screen.root
			.findAll((node) => node.type === "Text")
			.some((node) => node.props.children === "Keep editing this session"),
	).toBe(true);
	expect(mounts).toHaveBeenCalledOnce();
	screen.unmount();
});
