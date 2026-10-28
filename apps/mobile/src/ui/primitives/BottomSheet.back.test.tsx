import type GorhomBottomSheet from "@gorhom/bottom-sheet";
import { createRef } from "react";
import * as Native from "react-native";
import { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findAllByType, render } from "../__testing__/render";
import { BottomSheet } from "./BottomSheet";

const handles = vi.hoisted(
	() =>
		new Map<
			string,
			{ close: ReturnType<typeof vi.fn>; expand: ReturnType<typeof vi.fn> }
		>(),
);
vi.mock("@gorhom/bottom-sheet", async () => {
	const { createElement, forwardRef, useImperativeHandle, useMemo } =
		await import("react");
	const host =
		(name: string) =>
		({ children }: { children?: import("react").ReactNode }) =>
			createElement(name, null, children);
	return {
		default: forwardRef(
			(
				{
					children,
					accessibilityLabel,
					...props
				}: {
					children?: import("react").ReactNode;
					accessibilityLabel: string;
					backdropComponent?: import("react").ComponentType<
						import("@gorhom/bottom-sheet").BottomSheetBackdropProps
					>;
				},
				ref,
			) => {
				const handle = useMemo(() => ({ close: vi.fn(), expand: vi.fn() }), []);
				handles.set(accessibilityLabel, handle);
				useImperativeHandle(ref, () => handle, [handle]);
				return createElement(
					"BottomSheet",
					{ accessibilityLabel, ...props },
					props.backdropComponent
						? createElement(
								props.backdropComponent,
								{} as import("@gorhom/bottom-sheet").BottomSheetBackdropProps,
							)
						: null,
					children,
				);
			},
		),
		BottomSheetView: host("BottomSheetView"),
		BottomSheetScrollView: host("BottomSheetScrollView"),
		BottomSheetBackdrop: host("BottomSheetBackdrop"),
	};
});

let listeners: ((
	event: Native.HardwareBackPressEvent,
) => boolean | null | undefined)[];
let keyboard = false;
function back() {
	for (const listener of [...listeners].reverse())
		if (listener({ type: "hardwareBackPress", timeStamp: 0 })) return true;
	return false;
}
beforeEach(() => {
	listeners = [];
	keyboard = false;
	handles.clear();
	Object.assign(Native.Platform, { OS: "android" });
	vi.spyOn(Native.Keyboard, "isVisible").mockImplementation(() => keyboard);
	vi.spyOn(Native.Keyboard, "dismiss").mockImplementation(() => {
		keyboard = false;
	});
	vi.spyOn(Native.BackHandler, "addEventListener").mockImplementation(
		(_name, listener) => {
			listeners.push(listener);
			return {
				remove: () => {
					listeners = listeners.filter((item) => item !== listener);
				},
			};
		},
	);
});
afterEach(() => {
	vi.restoreAllMocks();
	Object.assign(Native.Platform, { OS: "ios" });
});

describe("actual bottom-sheet Android Back lifecycle", () => {
	it("lets an initially open nested sheet handle Back before its open parent", () => {
		const screen = render(
			<BottomSheet accessibilityLabel="parent" index={0}>
				<BottomSheet accessibilityLabel="child" index={0}>
					<Native.Text>Child</Native.Text>
				</BottomSheet>
			</BottomSheet>,
		);
		act(() => expect(back()).toBe(true));
		expect(handles.get("child")?.close).toHaveBeenCalledOnce();
		expect(handles.get("parent")?.close).not.toHaveBeenCalled();
		act(() =>
			findAllByType(screen.root, "BottomSheet")
				.find((sheet) => sheet.props.accessibilityLabel === "child")
				?.props.onChange(-1),
		);
		act(() => expect(back()).toBe(true));
		expect(handles.get("parent")?.close).toHaveBeenCalledOnce();
		screen.unmount();
	});
	it("consumes Back only for the latest open sheet, preserves the ref and cleans up", () => {
		const ref = createRef<GorhomBottomSheet>();
		const screen = render(
			<>
				<BottomSheet accessibilityLabel="first" index={-1} ref={ref}>
					<Native.Text>First</Native.Text>
				</BottomSheet>
				<BottomSheet accessibilityLabel="second" index={-1}>
					<Native.Text>Second</Native.Text>
				</BottomSheet>
			</>,
		);
		const sheets = findAllByType(screen.root, "BottomSheet");
		expect(back()).toBe(false);
		act(() => sheets[1]?.props.onAnimate(-1, 0));
		act(() => sheets[0]?.props.onAnimate(-1, 0));
		expect(ref.current).toBe(handles.get("first"));
		act(() => expect(back()).toBe(true));
		expect(handles.get("first")?.close).toHaveBeenCalledOnce();
		expect(handles.get("second")?.close).not.toHaveBeenCalled();
		act(() => sheets[0]?.props.onChange(-1));
		act(() => expect(back()).toBe(true));
		expect(handles.get("second")?.close).toHaveBeenCalledOnce();
		act(() => sheets[1]?.props.onChange(-1));
		expect(back()).toBe(false);
		act(() => sheets[0]?.props.onChange(0));
		screen.unmount();
		expect(listeners).toHaveLength(0);
		expect(back()).toBe(false);
		expect(ref.current).toBeNull();
	});
	it("dismisses the keyboard first and keeps active order stable through rerenders and snap changes", () => {
		const element = () => (
			<>
				<BottomSheet accessibilityLabel="first" index={0}>
					<Native.Text>First</Native.Text>
				</BottomSheet>
				<BottomSheet accessibilityLabel="second" index={-1}>
					<Native.Text>Second</Native.Text>
				</BottomSheet>
			</>
		);
		const screen = render(element());
		const sheets = findAllByType(screen.root, "BottomSheet");
		act(() => sheets[1]?.props.onChange(0));
		act(() => {
			sheets[0]?.props.onChange(1);
			screen.renderer.update(element());
		});
		keyboard = true;
		act(() => expect(back()).toBe(true));
		expect(Native.Keyboard.dismiss).toHaveBeenCalledOnce();
		expect(handles.get("first")?.close).not.toHaveBeenCalled();
		expect(handles.get("second")?.close).not.toHaveBeenCalled();
		act(() => expect(back()).toBe(true));
		expect(handles.get("second")?.close).toHaveBeenCalledOnce();
		expect(handles.get("first")?.close).not.toHaveBeenCalled();
		screen.unmount();
	});
	it("does not install Android interception on iOS", () => {
		Object.assign(Native.Platform, { OS: "ios" });
		const screen = render(
			<BottomSheet accessibilityLabel="ios" index={0}>
				<Native.Text>iOS</Native.Text>
			</BottomSheet>,
		);
		expect(listeners).toHaveLength(0);
		screen.unmount();
	});
});

it.each([
	"android",
	"ios",
])("retires an interrupted open on Gorhom onClose without onChange (%s)", (platform) => {
	Object.assign(Native.Platform, { OS: platform });
	const onClose = vi.fn(),
		onChange = vi.fn(),
		onAnimate = vi.fn();
	const screen = render(
		<BottomSheet
			accessibilityLabel="interrupted"
			index={-1}
			onClose={onClose}
			onChange={onChange}
			onAnimate={onAnimate}
		>
			<Native.Text>Content</Native.Text>
		</BottomSheet>,
	);
	const sheet = findAllByType(screen.root, "BottomSheet")[0];
	const backdrop = () =>
		screen.root.findAll(
			(node) => node.props.testID === "sheet-backdrop-boundary",
		)[0];
	expect(backdrop()?.props.pointerEvents).toBe("none");
	act(() => sheet?.props.onAnimate(-1, 0));
	expect(backdrop()?.props.pointerEvents).toBe("box-none");
	if (platform === "android") {
		act(() => expect(back()).toBe(true));
		expect(handles.get("interrupted")?.close).toHaveBeenCalledOnce();
	}
	// Installed Gorhom: interrupted -1→open→-1 finishes at its original current
	// index, so onChange and the closing onAnimate are both omitted; onClose fires.
	act(() => sheet?.props.onClose?.());
	expect(onClose).toHaveBeenCalledOnce();
	expect(onChange).not.toHaveBeenCalled();
	expect(onAnimate).toHaveBeenCalledExactlyOnceWith(-1, 0);
	expect(backdrop()?.props.pointerEvents).toBe("none");
	expect(listeners).toHaveLength(0);
	expect(back()).toBe(false);
	act(() => sheet?.props.onAnimate(-1, 0));
	act(() => sheet?.props.onChange(0));
	expect(backdrop()?.props.pointerEvents).toBe("box-none");
	act(() => sheet?.props.onChange(-1));
	act(() => sheet?.props.onClose?.());
	expect(onClose).toHaveBeenCalledTimes(2);
	expect(backdrop()?.props.pointerEvents).toBe("none");
	expect(listeners).toHaveLength(0);
	screen.unmount();
});

it("releases a nested sheet's ancestor lease on an interrupted onClose-only completion", () => {
	const screen = render(
		<BottomSheet accessibilityLabel="parent" index={0}>
			<BottomSheet accessibilityLabel="child" index={-1}>
				<Native.Text>Child</Native.Text>
			</BottomSheet>
		</BottomSheet>,
	);
	const child = findAllByType(screen.root, "BottomSheet").find(
		(sheet) => sheet.props.accessibilityLabel === "child",
	);
	act(() => child?.props.onAnimate(-1, 0));
	act(() => expect(back()).toBe(true));
	expect(handles.get("child")?.close).toHaveBeenCalledOnce();
	act(() => child?.props.onClose?.());
	expect(listeners).toHaveLength(1);
	act(() => expect(back()).toBe(true));
	expect(handles.get("parent")?.close).toHaveBeenCalledOnce();
	expect(handles.get("child")?.close).toHaveBeenCalledOnce();
	screen.unmount();
});
