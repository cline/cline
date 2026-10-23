import { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { render } from "@/ui/__testing__/render";
import { ReasoningPill, ReasoningSheet } from "./ReasoningControl";

describe("thinking choices", () => {
	it.each([
		false,
		undefined,
	])("does not offer changes when support is %s", (supported) => {
		const onPress = vi.fn();
		const { root } = render(
			<ReasoningPill supported={supported} onPress={onPress} />,
		);
		expect(
			root.findAll(
				(node) =>
					typeof node.type === "string" &&
					node.props.accessibilityRole === "button",
			),
		).toHaveLength(0);
		expect(onPress).not.toHaveBeenCalled();
	});
	it("offers the same five choices and saves only the explicit selection", () => {
		const onChange = vi.fn();
		const { root } = render(
			<ReasoningSheet
				supported
				value="low"
				onChange={onChange}
				sheetRef={{ current: null }}
			/>,
		);
		const options = root.findAll(
			(node) =>
				typeof node.type === "string" &&
				node.props.accessibilityRole === "radio",
		);
		expect(options.map((node) => node.props.accessibilityLabel)).toEqual(
			["None", "Low", "Medium", "High", "Extra"].map(
				(label) => `Thinking level: ${label}`,
			),
		);
		expect(onChange).not.toHaveBeenCalled();
		act(() => options[4].props.onPress());
		expect(onChange).toHaveBeenCalledWith("xhigh");
	});
});
