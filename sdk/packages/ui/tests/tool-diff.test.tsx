// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolFileDiff } from "../components/agent-chat/tool-diff";

// @pierre/diffs' custom element adopts constructable stylesheets, which jsdom
// does not implement; without this the suite exits nonzero on an unhandled
// error even with every test passing.
CSSStyleSheet.prototype.replaceSync ??= function replaceSync() {} as never;

// jsdom does not implement ResizeObserver either, which @pierre/diffs
// constructs on every render; without this each render logs a
// ReferenceError to stderr.
globalThis.ResizeObserver ??= class ResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
} as never;

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
	vi.restoreAllMocks();
});

async function render(element: React.ReactNode) {
	await act(async () => root.render(element));
}

function host(): HTMLElement {
	const element = container.querySelector<HTMLElement>("diffs-container");
	expect(element).not.toBeNull();
	return element as HTMLElement;
}

describe("ToolFileDiff", () => {
	it("renders the @pierre/diffs host with the background derived from the app token", async () => {
		await render(
			<ToolFileDiff newText={"b\n"} oldText={"a\n"} path="src/app.ts" />,
		);

		const element = host();
		expect(element.style.getPropertyValue("--diffs-light-bg")).toBe(
			"var(--background, light-dark(#fff, #000))",
		);
		expect(element.style.getPropertyValue("--diffs-dark-bg")).toBe(
			"var(--background, light-dark(#fff, #000))",
		);
	});

	it("inherits the app color-scheme so light-dark() palettes follow the app theme", async () => {
		// Regression: pierre's :host declares `color-scheme: light dark`,
		// which resolves token colors from the browser preference — light
		// syntax palette (near-black text) on a dark app surface.
		await render(
			<ToolFileDiff newText={"b\n"} oldText={"a\n"} path="src/app.ts" />,
		);

		expect(host().style.colorScheme).toBe("inherit");
	});

	it("defers to an explicitly pinned themeType instead of inheriting", async () => {
		await render(
			<ToolFileDiff
				newText={"b\n"}
				oldText={"a\n"}
				options={{ themeType: "dark" }}
				path="src/app.ts"
			/>,
		);

		expect(host().style.colorScheme).toBe("");
	});
});
