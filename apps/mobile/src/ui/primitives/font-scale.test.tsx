import { useEffect, useState } from "react";
import * as Native from "react-native";
import { act } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { findAllByType, render } from "../__testing__/render";
import { AutoGrowTextInput } from "./AutoGrowTextInput";
import { Text } from "./Text";
import { TextField } from "./TextField";

it.each([
	false,
	true,
])("remeasures only the TextField native host and preserves its controlled draft (inBottomSheet=%s)", (inBottomSheet) => {
	let fontScale = 1;
	const dimensions = vi
		.spyOn(Native, "useWindowDimensions")
		.mockImplementation(() => ({
			width: 820,
			height: 1180,
			scale: 2,
			fontScale,
		}));
	const mounted = vi.fn();
	const submit = vi.fn();
	function Owner() {
		const [draft, setDraft] = useState("Original query");
		useEffect(() => {
			mounted();
		}, []);
		return (
			<TextField
				variant="search"
				inBottomSheet={inBottomSheet}
				value={draft}
				onChangeText={setDraft}
				selection={{ start: 4, end: 4 }}
				onSubmitEditing={submit}
			/>
		);
	}
	try {
		const screen = render(<Owner />);
		const hostType = inBottomSheet ? "BottomSheetTextInput" : "TextInput";
		const input = () => findAllByType(screen.root, hostType)[0]!;
		act(() => input().props.onChangeText("PRIVATE unsent query 🌻"));
		let previous = input();
		// Focus renders do not replace native first responder.
		act(() => input().props.onFocus({}));
		expect(input()).toBe(previous);
		for (const scale of [3.1, 1]) {
			fontScale = scale;
			act(() => screen.renderer.update(<Owner />));
			expect(input() === previous).toBe(false);
			expect(input().props.value).toBe("PRIVATE unsent query 🌻");
			expect(input().props.selection).toEqual({ start: 4, end: 4 });
			previous = input();
		}
		expect(mounted).toHaveBeenCalledOnce();
		expect(submit).not.toHaveBeenCalled();
		screen.unmount();
	} finally {
		dimensions.mockRestore();
	}
});

it("preserves typed uncontrolled TextField text rather than restoring defaultValue after a font change", () => {
	let fontScale = 1;
	const dimensions = vi
		.spyOn(Native, "useWindowDimensions")
		.mockImplementation(() => ({
			width: 820,
			height: 1180,
			scale: 2,
			fontScale,
		}));
	const change = vi.fn();
	try {
		const screen = render(
			<TextField defaultValue="Original default" onChangeText={change} />,
		);
		const input = () => findAllByType(screen.root, "TextInput")[0]!;
		const previous = input();
		act(() => input().props.onChangeText("Keep native-only typed text 🌻"));
		fontScale = 3.1;
		act(() =>
			screen.renderer.update(
				<TextField
					defaultValue="New default must not overwrite editing"
					onChangeText={change}
				/>,
			),
		);
		expect(input() === previous).toBe(false);
		expect(input().props.defaultValue).toBe("Keep native-only typed text 🌻");
		expect(input().props.value).toBeUndefined();
		expect(change).toHaveBeenCalledExactlyOnceWith(
			"Keep native-only typed text 🌻",
		);
		screen.unmount();
	} finally {
		dimensions.mockRestore();
	}
});

it("remeasures native text after Dynamic Type changes without remounting the draft owner or replaying its work", () => {
	let fontScale = 1;
	const dimensions = vi
		.spyOn(Native, "useWindowDimensions")
		.mockImplementation(() => ({
			width: 402,
			height: 874,
			scale: 3,
			fontScale,
		}));
	const mounted = vi.fn();
	const submit = vi.fn();
	function DraftOwner() {
		const [draft, setDraft] = useState(
			"Keep the unsent paragraph and selection",
		);
		useEffect(() => {
			mounted();
		}, []);
		return (
			<>
				<Text variant="heading">Conversation title</Text>
				<AutoGrowTextInput
					value={draft}
					onChangeText={setDraft}
					selection={{ start: 5, end: 5 }}
					onSubmitEditing={submit}
				/>
			</>
		);
	}
	try {
		const result = render(<DraftOwner />);
		let previousText = findAllByType(result.root, "Text")[0];
		let previousInput = findAllByType(result.root, "TextInput")[0];
		for (const nextScale of [3.1, 1]) {
			fontScale = nextScale;
			act(() => result.renderer.update(<DraftOwner />));
			const text = findAllByType(result.root, "Text")[0];
			const input = findAllByType(result.root, "TextInput")[0];
			expect(text).not.toBe(previousText);
			expect(input).not.toBe(previousInput);
			expect(input?.props.value).toBe(
				"Keep the unsent paragraph and selection",
			);
			expect(input?.props.selection).toEqual({ start: 5, end: 5 });
			expect(mounted).toHaveBeenCalledTimes(1);
			expect(submit).not.toHaveBeenCalled();
			previousText = text;
			previousInput = input;
		}
	} finally {
		dimensions.mockRestore();
	}
});
