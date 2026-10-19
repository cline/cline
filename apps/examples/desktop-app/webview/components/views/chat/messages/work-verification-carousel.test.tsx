// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkVerification } from "@/lib/chat-schema";
import { WorkVerificationCarousel } from "./work-verification-carousel";

const verification: WorkVerification = {
	summary: "Verified in sandbox",
	target: "localhost:5173",
	durationMs: 38_000,
	screenshots: [
		{
			id: "a",
			src: "/a.webp",
			title: "Dashboard",
			action: "launch",
			outcome: "pass",
		},
		{
			id: "b",
			src: "/b.webp",
			title: "Dark mode",
			action: "click",
			outcome: "fail",
		},
		{ id: "c", src: "/c.webp", title: "Mobile", action: "resize" },
	],
};

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

const stageImage = () =>
	container.querySelector<HTMLImageElement>("button[aria-label^='Expand'] img");

describe("WorkVerificationCarousel", () => {
	it("summarizes the run and flags failed checks", async () => {
		await act(async () => {
			root.render(<WorkVerificationCarousel verification={verification} />);
		});
		expect(container.textContent).toContain("Verified in sandbox");
		expect(container.textContent).toContain(
			"localhost:5173 · 3 screenshots · 38s",
		);
		expect(container.textContent).toContain("1 check failed");
		expect(stageImage()?.alt).toBe("Dashboard");
	});

	it("navigates with the arrows and thumbnails and pauses autoplay", async () => {
		await act(async () => {
			root.render(<WorkVerificationCarousel verification={verification} />);
		});
		const next = container.querySelector<HTMLButtonElement>(
			"button[aria-label='Next screenshot']",
		);
		await act(async () => next?.click());
		expect(stageImage()?.alt).toBe("Dark mode");
		expect(
			container.querySelector("button[aria-label='Play slideshow']"),
		).not.toBeNull();

		const thumb = container.querySelector<HTMLButtonElement>(
			"button[aria-label='Show screenshot 3: Mobile']",
		);
		await act(async () => thumb?.click());
		expect(stageImage()?.alt).toBe("Mobile");
		expect(thumb?.getAttribute("aria-current")).toBe("true");
	});

	it("opens and closes the lightbox", async () => {
		await act(async () => {
			root.render(<WorkVerificationCarousel verification={verification} />);
		});
		const expand = container.querySelector<HTMLButtonElement>(
			"button[aria-label='Expand screenshot']",
		);
		await act(async () => expand?.click());
		const dialog = document.querySelector("[role='dialog']");
		expect(dialog?.textContent).toContain("1 / 3");
		await act(async () =>
			dialog
				?.querySelector<HTMLButtonElement>("button[aria-label='Close']")
				?.click(),
		);
		expect(document.querySelector("[role='dialog']")).toBeNull();
	});
});
