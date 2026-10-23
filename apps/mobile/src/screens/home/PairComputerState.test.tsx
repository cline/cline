import type { ReactTestInstance } from "react-test-renderer";
import { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { render } from "@/ui/__testing__/render";
import { containsText } from "../__testing__/harness";
import { HANDOFF_INSTRUCTION, PairComputerState } from "./PairComputerState";

function findByLabel(root: ReactTestInstance, label: string) {
	return root.findAll(
		(node) =>
			typeof node.type === "string" && node.props.accessibilityLabel === label,
	)[0];
}

describe("PairComputerState", () => {
	it("makes QR pairing the one concrete empty-state task", () => {
		const { root } = render(<PairComputerState onPair={() => {}} />);
		expect(containsText(root, "Connect Your Computer")).toBe(true);
		expect(containsText(root, "start or resume a conversation")).toBe(true);
		expect(containsText(root, HANDOFF_INSTRUCTION)).toBe(true);
		expect(findByLabel(root, "Scan QR Code")).toBeDefined();
		expect(containsText(root, "hub address")).toBe(false);
	});

	it("opens the scanner from the whole labelled button", () => {
		const onPair = vi.fn();
		const { root } = render(<PairComputerState onPair={onPair} />);
		act(() => findByLabel(root, "Scan QR Code")?.props.onPress());
		expect(onPair).toHaveBeenCalledOnce();
	});
});
