import { act } from "react-test-renderer";
import { containsText } from "../__testing__/harness";
import { describe, expect, it } from "vitest";
import {
	findAllByType,
	render,
	setReducedMotion,
} from "@/ui/__testing__/render";
import { ToolDiffView } from "./ToolDiffView";

describe("diff overlay motion", () => {
	it.each([true, false])("respects reduced motion = %s", (reduced) => {
		setReducedMotion(reduced);
		try {
			const { root } = render(<ToolDiffView files={[]} />);
			expect(findAllByType(root, "Modal")[0]?.props.animationType).toBe(
				reduced ? "none" : "slide",
			);
		} finally {
			setReducedMotion(false);
		}
	});
});

describe("complete paged diff review", () => {
	it("reaches lines beyond the old cutoff and files after the twentieth without mounting all content", () => {
		const files = Array.from({ length: 21 }, (_, index) => ({
			path: `file-${index}.ts`,
			additions: index === 0 ? 401 : 1,
			deletions: 0,
			lines:
				index === 0
					? Array.from({ length: 401 }, (_, line) => ({
							kind: "addition" as const,
							text: `CHANGE_${line}_END`,
						}))
					: [{ kind: "addition" as const, text: `FILE_${index}_END` }],
		}));
		const { root } = render(<ToolDiffView files={files} />);
		const press = (label: string) =>
			act(() =>
				root
					.findAll(
						(node) =>
							typeof node.type === "string" &&
							node.props.accessibilityLabel === label,
					)
					.at(-1)!
					.props.onPress(),
			);
		const open = root
			.findAll(
				(node) =>
					node.type === "Pressable" &&
					node.props.accessibilityLabel?.startsWith("Review diff"),
			)
			.at(-1)!;
		act(() => open.props.onPress());
		expect(containsText(root, "CHANGE_199_END")).toBe(true);
		expect(containsText(root, "CHANGE_200_END")).toBe(false);
		press("Next lines");
		expect(containsText(root, "CHANGE_200_END")).toBe(true);
		expect(containsText(root, "CHANGE_199_END")).toBe(false);
		press("Next lines");
		expect(containsText(root, "CHANGE_400_END")).toBe(true);
		for (let index = 0; index < 20; index++) press("Next file");
		expect(containsText(root, "FILE_20_END")).toBe(true);
		expect(containsText(root, "CHANGE_400_END")).toBe(false);
		press("Previous file");
		expect(containsText(root, "FILE_19_END")).toBe(true);
	});
});
