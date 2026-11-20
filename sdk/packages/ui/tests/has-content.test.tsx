import { Fragment } from "react";
import { describe, expect, it } from "vitest";
import { hasContent } from "../components/has-content.js";

describe("slot content", () => {
	it("ignores empty values, including nested arrays and fragments", () => {
		expect(
			hasContent([
				null,
				undefined,
				false,
				true,
				"",
				<Fragment key="empty">
					{[false, "", <Fragment key="nested" />]}
				</Fragment>,
			]),
		).toBe(false);
	});

	it("preserves zero, whitespace, and text nested in fragments", () => {
		for (const content of [0, " ", <Fragment key="text">Ready</Fragment>]) {
			expect(hasContent(content)).toBe(true);
		}
	});

	it("does not invoke opaque child components to inspect their output", () => {
		function Child(): never {
			throw new Error("Slot inspection must not render children");
		}
		expect(hasContent(<Child />)).toBe(true);
	});
});
