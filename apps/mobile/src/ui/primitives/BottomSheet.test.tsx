import * as Native from "react-native";
import { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findAllByType, render } from "../__testing__/render";
import { BottomSheet } from "./BottomSheet";

// Render the supplied backdrop as a component, exactly as Gorhom does. Merely
// invoking the prop as a function cannot detect component identity/remount bugs.
vi.mock("@gorhom/bottom-sheet", async () => {
	const { createElement } = await import("react");
	const host =
		(name: string) =>
		({
			children,
			...props
		}: {
			children?: import("react").ReactNode;
			[key: string]: unknown;
		}) =>
			createElement(name, props, children);
	return {
		default: ({
			children,
			backdropComponent: Backdrop,
			...props
		}: {
			children?: import("react").ReactNode;
			backdropComponent?: import("react").ComponentType<
				import("@gorhom/bottom-sheet").BottomSheetBackdropProps
			>;
			[key: string]: unknown;
		}) =>
			createElement(
				"BottomSheet",
				{ ...props, backdropComponent: Backdrop },
				Backdrop
					? createElement(Backdrop, {
							animatedIndex: { value: -0.99 },
							animatedPosition: { value: 0 },
						} as never)
					: null,
				children,
			),
		BottomSheetView: host("BottomSheetView"),
		BottomSheetScrollView: host("BottomSheetScrollView"),
		BottomSheetBackdrop: host("BottomSheetBackdrop"),
	};
});
afterEach(() => vi.restoreAllMocks());
describe("sheet backdrop lifecycle", () => {
	it("dismisses the owned keyboard on visible backdrop taps without letting a hidden sheet dismiss another input", () => {
		const dismiss = vi.spyOn(Native.Keyboard, "dismiss");
		const result = render(
			<BottomSheet index={-1}>
				<Native.Text>Picker</Native.Text>
			</BottomSheet>,
		);
		const backdrop = () =>
			findAllByType(result.root, "BottomSheetBackdrop").at(-1)!;
		act(() => backdrop().props.onPress());
		expect(dismiss).not.toHaveBeenCalled();
		act(() =>
			findAllByType(result.root, "BottomSheet").at(-1)!.props.onChange(0),
		);
		act(() => backdrop().props.onPress());
		expect(dismiss).toHaveBeenCalledOnce();
		act(() =>
			findAllByType(result.root, "BottomSheet").at(-1)!.props.onChange(-1),
		);
		act(() => backdrop().props.onPress());
		expect(dismiss).toHaveBeenCalledOnce();
	});
	it("keeps closed sheets noninteractive and invisible across fold/index drift", () => {
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
		const original = findAllByType(result.root, "BottomSheetBackdrop").at(-1)!;
		for (const nextWidth of [1088, 555, 1088, 555]) {
			width = nextWidth;
			act(() =>
				result.renderer.update(
					<BottomSheet index={-1}>
						<Native.Text>Models</Native.Text>
					</BottomSheet>,
				),
			);
			const boundary = result.root.find(
				(node) => node.props.testID === "sheet-backdrop-boundary",
			);
			expect(boundary.props.pointerEvents).toBe("none");
			expect(boundary.props.accessibilityElementsHidden).toBe(true);
			expect(boundary.props.importantForAccessibility).toBe(
				"no-hide-descendants",
			);
			expect(boundary.props.collapsable).toBe(false);
			const visibility = result.root.find(
				(node) => node.props.testID === "sheet-visibility-boundary",
			);
			expect(visibility.props.pointerEvents).toBe("none");
			expect(visibility.props.accessibilityElementsHidden).toBe(true);
			expect(Native.StyleSheet.flatten(visibility.props.style).opacity).toBe(0);
			expect(findAllByType(result.root, "BottomSheetBackdrop").at(-1)!).toBe(
				original,
			);
			expect(original.props.opacity).toBe(0);
		}
	});
	it("preserves component identity and the same native backdrop through repeated open/close cycles", () => {
		const onAnimate = vi.fn();
		const onChange = vi.fn();
		const result = render(
			<BottomSheet index={-1} onAnimate={onAnimate} onChange={onChange}>
				<Native.Text>Models</Native.Text>
			</BottomSheet>,
		);
		const sheet = () => findAllByType(result.root, "BottomSheet").at(-1)!;
		const component = sheet().props.backdropComponent;
		const original = findAllByType(result.root, "BottomSheetBackdrop").at(-1)!;
		const boundary = () =>
			result.root.find(
				(node) => node.props.testID === "sheet-backdrop-boundary",
			);
		for (let cycle = 0; cycle < 3; cycle++) {
			act(() => sheet().props.onAnimate(-1, 0, 876, 200));
			expect(boundary().props.pointerEvents).toBe("box-none");
			expect(original.props.opacity).toBe(0.5);
			const visibility = result.root.find(
				(node) => node.props.testID === "sheet-visibility-boundary",
			);
			expect(visibility.props.pointerEvents).toBe("box-none");
			expect(Native.StyleSheet.flatten(visibility.props.style).opacity).toBe(1);
			expect(original.props.pressBehavior).toBe("close");
			act(() => sheet().props.onChange(0, 200, 0));
			act(() => sheet().props.onAnimate(0, -1, 200, 876));
			expect(boundary().props.pointerEvents).toBe("box-none");
			expect(Native.StyleSheet.flatten(visibility.props.style).opacity).toBe(1);
			act(() => sheet().props.onChange(-1, 876, 0));
			expect(Native.StyleSheet.flatten(visibility.props.style).opacity).toBe(0);
			expect(boundary().props.pointerEvents).toBe("none");
			expect(original.props.opacity).toBe(0);
			expect(sheet().props.backdropComponent).toBe(component);
			expect(findAllByType(result.root, "BottomSheetBackdrop").at(-1)!).toBe(
				original,
			);
		}
		expect(onAnimate).toHaveBeenCalledWith(0, -1, 200, 876);
		expect(onChange).toHaveBeenCalledWith(-1, 876, 0);
	});
	it("supports initially open and motion-free changes without swapping hierarchy", () => {
		const result = render(
			<BottomSheet index={0}>
				<Native.Text>Approval</Native.Text>
			</BottomSheet>,
		);
		const sheet = () => findAllByType(result.root, "BottomSheet").at(-1)!;
		const original = findAllByType(result.root, "BottomSheetBackdrop").at(-1)!;
		const boundary = () =>
			result.root.find(
				(node) => node.props.testID === "sheet-backdrop-boundary",
			);
		expect(boundary().props.pointerEvents).toBe("box-none");
		act(() => sheet().props.onChange(-1, 876, 0));
		expect(boundary().props.pointerEvents).toBe("none");
		act(() => sheet().props.onChange(0, 200, 0));
		expect(boundary().props.pointerEvents).toBe("box-none");
		expect(findAllByType(result.root, "BottomSheetBackdrop").at(-1)!).toBe(
			original,
		);
	});
	it("omits the backdrop when explicitly disabled", () => {
		const result = render(
			<BottomSheet index={0} withBackdrop={false}>
				<Native.Text>Uncovered</Native.Text>
			</BottomSheet>,
		);
		expect(findAllByType(result.root, "BottomSheetBackdrop")).toHaveLength(0);
	});
});
