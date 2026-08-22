// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PageFrame } from "./page-layout";

let container: HTMLDivElement;
let root: Root;

class ResizeObserverStub {
	disconnect() {}
	observe() {}
	unobserve() {}
}

beforeEach(() => {
	Object.assign(globalThis, {
		IS_REACT_ACT_ENVIRONMENT: true,
		ResizeObserver: ResizeObserverStub,
	});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("PageFrame", () => {
	it("marks document-like page content as selectable", async () => {
		await act(async () => {
			root.render(<PageFrame>Copy this text</PageFrame>);
		});

		const content = container.querySelector(".cline-page-selectable");
		expect(content?.textContent).toBe("Copy this text");
	});
});
