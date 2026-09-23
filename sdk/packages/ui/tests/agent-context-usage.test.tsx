import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
	AgentContextUsage,
	type AgentContextUsageData,
} from "../components/agent-context-usage.js";

const usage: AgentContextUsageData = {
	tokensIn: 1_000,
	tokensOut: 500,
	cacheReadTokens: 250,
	contextWindow: 2_000,
};

function render(data = usage, costLabel?: ReactNode) {
	return renderToStaticMarkup(
		<AgentContextUsage costLabel={costLabel} usage={data}>
			{({ triggerLabel, ring, details }) => (
				<>
					<button aria-label={triggerLabel} type="button">
						{ring}
					</button>
					{details}
				</>
			)}
		</AgentContextUsage>,
	);
}

describe("AgentContextUsage", () => {
	it("does not mount host controls until context and token usage exist", () => {
		for (const data of [
			{ ...usage, contextWindow: undefined },
			{ ...usage, contextWindow: 0 },
			{ ...usage, tokensIn: 0, tokensOut: 0 },
		]) {
			const children = vi.fn(() => <button type="button">Usage</button>);
			expect(
				renderToStaticMarkup(
					<AgentContextUsage usage={data}>{children}</AgentContextUsage>,
				),
			).toBe("");
			expect(children).not.toHaveBeenCalled();
		}
	});

	it.each([
		[499, "stroke-cline-ui-primary"],
		[500, "stroke-orange-500"],
		[750, "stroke-red-500"],
	])("preserves the desktop warning thresholds at %i tokens", (tokensIn, tone) => {
		expect(
			render({ ...usage, tokensIn, tokensOut: 0, contextWindow: 1_000 }),
		).toContain(`class="${tone}"`);
	});

	it("uses current input plus output for the ring, with cost provided by the host", () => {
		const markup = render(usage, "$0.014");
		expect(markup).toContain(
			'aria-label="Context window: 1,500 of 2,000 tokens used (75%)"',
		);
		expect(markup).toContain("1.5k / 2k (75%)");
		expect(markup).toContain("$0.014");
		expect(markup).toContain(
			'data-token-kind="uncached-input" style="width:37.5%"',
		);
		expect(markup).toContain("width:12.5%");
		expect(markup).toContain("width:25%");
	});

	it.each([
		[undefined, false],
		[null, false],
		["", false],
		[false, false],
		[Number.NaN, false],
		[0, true],
		["$0.014", true],
	] as const)("preserves cost-row visibility for %p", (costLabel, visible) => {
		const markup = render(usage, costLabel);
		if (visible) {
			expect(markup).toContain(">Cost<");
		} else {
			expect(markup).not.toContain(">Cost<");
		}
		if (costLabel === 0) {
			expect(markup).toMatch(/>Cost<\/span><span[^>]*>0<\/span>/);
		}
	});

	it("caps the ring and scales segments when a model has a smaller context window", () => {
		const markup = render({
			...usage,
			contextWindow: 750,
			cacheReadTokens: 2_000,
		});
		expect(markup).toContain("tokens used (100%)");
		expect(markup).toContain('stroke-dashoffset="0"');
		expect(markup).toContain(
			'data-token-kind="uncached-input" style="width:0%"',
		);
		// Display the reported cache value, but never draw it beyond input usage.
		expect(markup).toContain(">2,000</span>");
		expect(markup).toContain("width:66.66666666666666%");
		expect(markup).toContain("width:33.33333333333333%");
	});

	it("supports output-only usage and keeps the established million-token label", () => {
		expect(render({ ...usage, tokensIn: 0, tokensOut: 500 })).toContain(
			"500 of 2,000 tokens used (25%)",
		);
		expect(render({ ...usage, contextWindow: 1_000_000 })).toContain(
			"1.5k / 1.0M (0%)",
		);
	});
});
