import { describe, expect, it } from "vitest";
import { render } from "../../ui/__testing__/render";
import { containsText } from "../__testing__/harness";
import { RunSummaryCard } from "./RunSummaryCard";

describe("RunSummaryCard approval outcomes", () => {
	it.each([
		["deniedCount", "1 tool call denied"],
		["expiredCount", "1 approval expired"],
		["cancelledCount", "1 approval cancelled"],
	] as const)("announces %s without a failed-tool warning", (field, copy) => {
		const { root } = render(
			<RunSummaryCard
				lastRun={{ outcome: "completed" }}
				summary={{
					toolCount: 1,
					failedCount: 0,
					files: [],
					additions: 0,
					deletions: 0,
					[field]: 1,
				}}
			/>,
		);
		expect(containsText(root, copy)).toBe(true);
		expect(containsText(root, "failed — see")).toBe(false);
		const card = root.find((node) => node.props.testID === "run-summary");
		expect(card.props.accessibilityLabel).toContain(copy);
	});
});
