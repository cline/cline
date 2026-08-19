// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Badge } from "../components/index.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

async function render(node: ReactNode) {
	await act(async () => root.render(node));
}

describe("Badge", () => {
	it("renders its content with the default styling", async () => {
		await render(<Badge>Required</Badge>);
		const badge = container.querySelector("span");
		expect(badge?.textContent).toBe("Required");
		expect(badge?.dataset.slot).toBe("badge");
		expect(badge?.className).toContain("border-cline-ui-border");
		expect(badge?.className).toContain("bg-cline-ui-surface-hover-lighter");
	});

	it("forwards native props, refs, and custom classes", async () => {
		let forwardedRef: HTMLSpanElement | null = null;
		await render(
			<Badge
				aria-label="Status"
				className="consumer-class"
				ref={(node) => {
					forwardedRef = node;
				}}
				title="Current status"
			>
				Active
			</Badge>,
		);
		const badge = container.querySelector<HTMLSpanElement>("span");
		expect(forwardedRef).toBe(badge);
		expect(badge?.className).toContain("consumer-class");
		expect(badge?.getAttribute("aria-label")).toBe("Status");
		expect(badge?.title).toBe("Current status");
	});
});
