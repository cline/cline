import { useEffect, useState } from "react";
import * as Native from "react-native";
import { act } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { findAllByType, render } from "../__testing__/render";
import { AutoGrowTextInput } from "./AutoGrowTextInput";
import { Text } from "./Text";

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
