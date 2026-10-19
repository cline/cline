// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	type AgentScreenshot,
	AgentScreenshotCarousel,
} from "../components/agent-screenshot-carousel.js";

const shots: AgentScreenshot[] = [
	{
		id: "a",
		src: "data:image/png;base64,a",
		title: "Board renders",
		action: "launch",
		detail: "localhost:5173",
		status: "passed",
	},
	{
		id: "b",
		src: "data:image/png;base64,b",
		title: "Palette opens",
		action: "key",
		detail: "Ctrl+K",
		status: "passed",
	},
	{
		id: "c",
		src: "data:image/png;base64,c",
		title: "Search narrows",
		action: "type",
		pointer: { x: 0.5, y: 0.3 },
		status: "passed",
	},
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
});

const activeTab = () =>
	container.querySelector<HTMLButtonElement>(
		'[role="tab"][aria-selected="true"]',
	);
const caption = () =>
	container.querySelector(".cline-ui-shots__caption")?.textContent ?? "";

it("advances when the active progress bar finishes and pauses on hover", async () => {
	await act(async () =>
		root.render(<AgentScreenshotCarousel screenshots={shots} />),
	);
	const section = container.querySelector("section");
	expect(section?.getAttribute("aria-roledescription")).toBe("carousel");
	expect(section?.hasAttribute("data-running")).toBe(true);
	expect(caption()).toContain("1/3");
	expect(caption()).toContain("Launched");
	expect(caption()).toContain("localhost:5173");
	expect(container.textContent).toContain("3/3 checks passed");

	const fill = activeTab()?.querySelector(".cline-ui-shots__progress-fill");
	await act(async () =>
		fill?.dispatchEvent(new Event("animationend", { bubbles: true })),
	);
	expect(activeTab()?.getAttribute("aria-label")).toBe(
		"Show screenshot 2: Palette opens",
	);
	expect(caption()).toContain("Ctrl+K");

	const stage = container.querySelector<HTMLDivElement>(
		".cline-ui-shots__stage",
	);
	await act(async () =>
		stage?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
	);
	expect(section?.hasAttribute("data-running")).toBe(false);
});

it("navigates with thumbnails, arrows, and the keyboard, and toggles playback", async () => {
	const onExpand = vi.fn();
	await act(async () =>
		root.render(
			<AgentScreenshotCarousel onExpand={onExpand} screenshots={shots} />,
		),
	);
	const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
	await act(async () => tabs[2]?.click());
	expect(caption()).toContain("Search narrows");
	expect(container.querySelector(".cline-ui-shots__pointer")).not.toBeNull();
	expect(tabs[0]?.dataset.state).toBe("past");

	await act(async () =>
		container
			.querySelector<HTMLButtonElement>('[aria-label="Next screenshot"]')
			?.click(),
	);
	expect(caption()).toContain("Board renders");

	const stage = container.querySelector<HTMLDivElement>(
		".cline-ui-shots__stage",
	);
	await act(async () =>
		stage?.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
		),
	);
	expect(caption()).toContain("Search narrows");

	await act(async () =>
		container
			.querySelector<HTMLButtonElement>('[aria-label="Expand screenshot"]')
			?.click(),
	);
	expect(onExpand).toHaveBeenCalledWith(shots[2], 2);

	const play = container.querySelector<HTMLButtonElement>(
		'[aria-label="Pause slideshow"]',
	);
	await act(async () => play?.click());
	expect(play?.getAttribute("aria-label")).toBe("Play slideshow");
	expect(container.querySelector("section")?.hasAttribute("data-running")).toBe(
		false,
	);
});

it("summarizes failures and renders nothing without screenshots", async () => {
	await act(async () =>
		root.render(
			<AgentScreenshotCarousel
				autoPlay={false}
				screenshots={[{ ...shots[0], status: "failed" }, shots[1]]}
			/>,
		),
	);
	expect(container.textContent).toContain("1 failed");
	expect(
		container.querySelector('[aria-label="Play slideshow"]'),
	).not.toBeNull();

	await act(async () =>
		root.render(<AgentScreenshotCarousel screenshots={[]} />),
	);
	expect(container.innerHTML).toBe("");
});
