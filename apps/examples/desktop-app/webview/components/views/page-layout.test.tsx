// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PAGE_FRAME_FIT_VIEWPORT, PageFrame, PageHeader } from "./page-layout";

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

const render = (fit: boolean) =>
	act(async () =>
		root.render(
			<PageFrame fit={fit}>
				<PageHeader fit={fit} title="Page" actions={<button>Act</button>} />
			</PageFrame>,
		),
	);
const frame = () => container.querySelector('[data-slot="scroll-area"]');
const viewport = () =>
	container.querySelector('[data-slot="scroll-area-viewport"]');
const padding = () => viewport()?.firstElementChild?.firstElementChild;
const actions = () => container.querySelector("[data-page-header-actions]");

describe("PageFrame and PageHeader", () => {
	it("keep the window breakpoints other pages use by default", async () => {
		await render(false);
		expect(frame()?.className).not.toContain("@container");
		expect(frame()?.hasAttribute("data-page-frame-fit")).toBe(false);
		expect(viewport()?.className).not.toContain(PAGE_FRAME_FIT_VIEWPORT);
		expect(padding()?.className).toBe(
			"px-18 py-10 max-[1200px]:px-8 max-[720px]:px-4 max-[720px]:py-5",
		);
		expect(actions()?.className).toBe(
			"flex flex-wrap items-center justify-end gap-2 shrink-0 max-[860px]:justify-start",
		);
		expect(actions()?.parentElement?.className).toContain(
			"max-[860px]:flex-col",
		);
	});

	it("lay a fit page out in its own width: block content, container padding and wrapping actions", async () => {
		await render(true);
		expect(frame()?.className).toContain("@container/page");
		expect(viewport()?.className).toContain("[&>div]:block!");
		expect(padding()?.className).toBe(
			"px-4 py-5 @min-[720px]/page:px-8 @min-[720px]/page:py-10 @min-[1200px]/page:px-18",
		);
		expect(actions()?.className.split(" ")).toContain("min-w-0");
		expect(actions()?.className.split(" ")).not.toContain("shrink-0");
		expect(actions()?.parentElement?.className).toContain(
			"@max-[860px]/page:flex-col",
		);
		expect(actions()?.parentElement?.className.split(" ")).not.toContain(
			"max-[860px]:flex-col",
		);
	});
});
