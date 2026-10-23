import * as Native from "react-native";
import { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findAllByType, render } from "../__testing__/render";
import { BottomSheet } from "./BottomSheet";

afterEach(() => vi.restoreAllMocks());

describe("sheet backdrop lifecycle", () => {
	it("does not mount a touch-blocking backdrop for closed sheets across fold changes", () => {
		let width = 555;
		vi.spyOn(Native, "useWindowDimensions").mockImplementation(() => ({
			width,
			height: width === 555 ? 876 : 821,
			scale: 2.25,
			fontScale: 1,
		}));
		const result = render(
			<BottomSheet index={-1}>
				<Native.Text>Models</Native.Text>
			</BottomSheet>,
		);
		for (const nextWidth of [1088, 555, 1088, 555]) {
			width = nextWidth;
			act(() =>
				result.renderer.update(
					<BottomSheet index={-1}>
						<Native.Text>Models</Native.Text>
					</BottomSheet>,
				),
			);
			const sheet = findAllByType(result.root, "BottomSheet").at(-1)!;
			// Native resize can leave the interpolated index above closed (-1),
			// despite no open request or settled open index.
			expect(
				sheet.props.backdropComponent({ animatedIndex: { value: -0.99 } }),
			).toBeNull();
		}
	});

	it("keeps the backdrop through close animation, removes it on close, and supports reopening", () => {
		const onAnimate = vi.fn();
		const onChange = vi.fn();
		const result = render(
			<BottomSheet index={-1} onAnimate={onAnimate} onChange={onChange}>
				<Native.Text>Models</Native.Text>
			</BottomSheet>,
		);
		const sheet = () => findAllByType(result.root, "BottomSheet").at(-1)!;
		const backdrop = () =>
			sheet().props.backdropComponent({ animatedIndex: { value: 0 } });
		act(() => sheet().props.onAnimate(-1, 0, 876, 200));
		expect(backdrop()).not.toBeNull();
		act(() => sheet().props.onChange(0, 200, 0));
		act(() => sheet().props.onAnimate(0, -1, 200, 876));
		expect(backdrop()).not.toBeNull();
		act(() => sheet().props.onChange(-1, 876, 0));
		expect(backdrop()).toBeNull();
		expect(onAnimate).toHaveBeenCalledWith(0, -1, 200, 876);
		expect(onChange).toHaveBeenCalledWith(-1, 876, 0);
		act(() => sheet().props.onAnimate(-1, 0, 876, 200));
		expect(backdrop()).not.toBeNull();
	});

	it("supports initially open sheets and motion-free index changes", () => {
		const result = render(
			<BottomSheet index={0}>
				<Native.Text>Approval</Native.Text>
			</BottomSheet>,
		);
		const sheet = () => findAllByType(result.root, "BottomSheet").at(-1)!;
		expect(sheet().props.backdropComponent({})).not.toBeNull();
		act(() => sheet().props.onChange(-1, 876, 0));
		expect(sheet().props.backdropComponent({})).toBeNull();
		act(() => sheet().props.onChange(0, 200, 0));
		expect(sheet().props.backdropComponent({})).not.toBeNull();
	});
});
