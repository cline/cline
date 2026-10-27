// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-has-connected-provider", () => ({
	useHasConnectedProvider: () => true,
}));

import { SettingsHostLayout } from "./settings-host-layout";

let container: HTMLDivElement;
let root: Root;

function setWide(matches: boolean) {
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: vi.fn(() => ({
			matches,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	});
}

async function render(onSelect = vi.fn(), onBack = vi.fn()) {
	await act(async () => {
		root.render(
			<SettingsHostLayout onBack={onBack} onSelect={onSelect} section="General">
				<p data-testid="page">General page</p>
			</SettingsHostLayout>,
		);
	});
	return { onSelect, onBack };
}

const navLabels = () =>
	Array.from(
		container.querySelectorAll<HTMLButtonElement>(
			'[aria-label="Settings sections"] button',
		),
	).map((button) => button.getAttribute("aria-label"));

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

describe("SettingsHostLayout", () => {
	it("renders the desktop section list beside the page", async () => {
		setWide(true);
		await render();

		expect(container.querySelector('[data-testid="page"]')).not.toBeNull();
		const labels = navLabels();
		// The app sidebar's own rows (Schedule, Customize) don't exist
		// here, so the list carries them too.
		expect(labels).toEqual(
			expect.arrayContaining([
				"General",
				"Provider",
				"Schedules",
				"Installed",
				"Marketplace",
				"About",
			]),
		);
		const general = container.querySelector(
			'[aria-label="Settings sections"] [aria-current="page"]',
		);
		expect(general?.getAttribute("aria-label")).toBe("General");
		expect(container.textContent).toContain("Back");
	});

	it("collapses to the icon rail in a narrow panel", async () => {
		setWide(false);
		await render();

		const nav = container.querySelector('[aria-label="Settings sections"]');
		// Collapsed: icons only, no group heading or text labels.
		expect(nav?.textContent).toBe("");
		expect(navLabels()).toEqual(
			expect.arrayContaining(["General", "Installed", "Marketplace"]),
		);
	});

	it("selects sections and goes back", async () => {
		setWide(true);
		const { onSelect, onBack } = await render();

		const about = container.querySelector<HTMLButtonElement>(
			'[aria-label="Settings sections"] button[aria-label="About"]',
		);
		await act(async () => about?.click());
		expect(onSelect).toHaveBeenCalledWith("About");

		const back = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Back to conversation"]',
		);
		await act(async () => back?.click());
		expect(onBack).toHaveBeenCalled();
	});
});
