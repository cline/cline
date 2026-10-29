// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	readWorkspacePanelWidth,
	writeWorkspacePanelWidth,
} from "./workspace-panel";

function mountMain(width: number): HTMLElement {
	const main = document.createElement("main");
	main.dataset.slot = "sidebar-inset";
	main.getBoundingClientRect = () => ({ width }) as DOMRect;
	document.body.appendChild(main);
	return main;
}

beforeEach(() => {
	window.localStorage.clear();
	Object.defineProperty(window, "innerWidth", {
		configurable: true,
		value: 1500,
	});
});

afterEach(() => {
	document.body.replaceChildren();
});

describe("readWorkspacePanelWidth", () => {
	it.each([
		900, 1260, 1600,
	])("keeps the default side chat narrower than main at %s pixels", (width) => {
		mountMain(width);
		expect(readWorkspacePanelWidth("side")).toBe(Math.round(width * 0.4));
	});

	it("defaults to 60% of the main content area beside the sidebar", () => {
		mountMain(1600);
		expect(readWorkspacePanelWidth()).toBe(960);
	});

	it("still leaves the conversation room in a narrow window", () => {
		mountMain(900);
		expect(readWorkspacePanelWidth()).toBe(900 - 420);
	});

	it("prefers a width the user dragged to, within bounds", () => {
		mountMain(1260);
		writeWorkspacePanelWidth(700);
		expect(readWorkspacePanelWidth()).toBe(700);
		writeWorkspacePanelWidth(5000);
		// The conversation keeps room for the composer.
		expect(readWorkspacePanelWidth()).toBe(1260 - 420);
	});

	it("falls back to the window width before the main area exists", () => {
		expect(readWorkspacePanelWidth()).toBe(900);
	});
});
