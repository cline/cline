// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentHeroHeading } from "../components/index.js";

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
	vi.useRealTimers();
	vi.restoreAllMocks();
});

async function renderHeading() {
	await act(async () => root.render(<AgentHeroHeading />));
}

describe("AgentHeroHeading", () => {
	it("renders a stable accessible heading", async () => {
		vi.useFakeTimers();
		window.matchMedia = vi.fn().mockReturnValue({ matches: true });
		await renderHeading();

		const heading = container.querySelector("h1");
		expect(heading?.getAttribute("aria-label")).toBe(
			"What would you like to build?",
		);
		expect(
			container.querySelector(".cline-ui-agent-hero-heading__word")
				?.textContent,
		).toBe("build");

		await act(async () => vi.advanceTimersByTime(5000));

		expect(
			container.querySelector(".cline-ui-agent-hero-heading__word")
				?.textContent,
		).toBe("build");
	});

	it("cycles the visible verb when reduced motion is not requested", async () => {
		vi.useFakeTimers();
		window.matchMedia = vi.fn().mockReturnValue({ matches: false });
		await renderHeading();

		await act(async () => vi.advanceTimersByTime(5000));

		expect(
			container.querySelector(".cline-ui-agent-hero-heading__word")
				?.textContent,
		).toBe("create");
	});
});
