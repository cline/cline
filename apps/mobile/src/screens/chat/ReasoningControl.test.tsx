import { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { render } from "@/ui/__testing__/render";
import { containsText, findByLabel } from "../__testing__/harness";
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
			["Off", "Low", "Medium", "High", "Extra"].map(
				(label) => `Thinking level: ${label}`,
			),
		);
		expect(onChange).not.toHaveBeenCalled();
		act(() => options[4].props.onPress());
		expect(onChange).toHaveBeenCalledWith("xhigh");
	});
	it("explains explicit off without confusing it with unknown or unsupported capability", () => {
		const off = render(
			<ReasoningPill value="none" supported onPress={vi.fn()} />,
		);
		expect(containsText(off.root, "Thinking: off")).toBe(true);
		expect(
			findByLabel(off.root, "Thinking level: Off")?.props.accessibilityHint,
		).toContain("Extra thinking is off for your next message");
		const unknownLevel = render(<ReasoningPill supported onPress={vi.fn()} />);
		expect(
			findByLabel(unknownLevel.root, "Thinking level: Model setting")?.props
				.accessibilityHint,
		).toContain("current level was not reported");
		const unsupported = render(
			<ReasoningPill value="none" supported={false} onPress={vi.fn()} />,
		);
		expect(containsText(unsupported.root, "Thinking unavailable")).toBe(true);
		const checking = render(<ReasoningPill onPress={vi.fn()} />);
		expect(containsText(checking.root, "Checking thinking")).toBe(true);
	});
	it("describes thinking and sends the existing none wire value when Off is selected", () => {
		const onChange = vi.fn();
		const { root } = render(
			<ReasoningSheet
				supported
				onChange={onChange}
				sheetRef={{ current: null }}
			/>,
		);
		expect(
			containsText(root, "Higher levels can take longer and use more tokens"),
		).toBe(true);
		expect(containsText(root, "current level is not reported")).toBe(true);
		expect(containsText(root, "Do not request extra thinking")).toBe(true);
		act(() => findByLabel(root, "Thinking level: Off")?.props.onPress());
		expect(onChange).toHaveBeenCalledWith("none");
	});
});
