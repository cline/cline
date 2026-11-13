// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	CustomizeCategoryTransitionProvider,
	CustomizePillSelector,
	CustomizePillSelectorItem,
} from "./customize-pill-selector";

// Motion captures its frame scheduler when imported. Install a controllable
// browser clock before loading the real engine, rather than mocking Motion.
const clock = vi.hoisted(() => {
	const state = {
		now: 0,
		nextFrame: 0,
		reducedMotion: false,
		mediaListeners: new Set<() => void>(),
		frames: new Map<number, FrameRequestCallback>(),
	};
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		state.frames.set(++state.nextFrame, callback);
		return state.nextFrame;
	});
	vi.stubGlobal("cancelAnimationFrame", (frame: number) =>
		state.frames.delete(frame),
	);
	vi.stubGlobal("matchMedia", () => ({
		get matches() {
			return state.reducedMotion;
		},
		media: "(prefers-reduced-motion: reduce)",
		addListener(listener: () => void) {
			state.mediaListeners.add(listener);
		},
		removeListener(listener: () => void) {
			state.mediaListeners.delete(listener);
		},
		addEventListener(_event: string, listener: () => void) {
			state.mediaListeners.add(listener);
		},
		removeEventListener(_event: string, listener: () => void) {
			state.mediaListeners.delete(listener);
		},
	}));
	return state;
});

type Page = "browse" | "manage";
const categories = {
	browse: [
		["all", 0, 50],
		["connectors", 60, 150],
		["plugins", 220, 90],
		["skills", 320, 85],
		["mcp", 415, 65],
	],
	manage: [
		["all", 0, 50],
		["connectors", 60, 160],
		["tools", 235, 82],
		["plugins", 330, 110],
		["skills", 450, 90],
		["rules", 550, 75],
		["mcp", 635, 80],
		["hooks", 725, 75],
	],
} as const;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	clock.reducedMotion = false;
	for (const listener of clock.mediaListeners) listener();
	vi.spyOn(performance, "now").mockImplementation(() => clock.now);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		function (this: HTMLElement) {
			const pill = this.closest<HTMLElement>("[data-customize-category]");
			const isContent = pill && this !== pill;
			const left = Number(pill?.dataset.left ?? 0) + (isContent ? 16 : 0);
			const top = Number(pill?.dataset.top ?? 80);
			const width = Number(pill?.dataset.width ?? 1000) - (isContent ? 32 : 0);
			return {
				x: left,
				y: top,
				left,
				top,
				width,
				height: 36,
				right: left + width,
				bottom: top + 36,
				toJSON() {},
			};
		},
	);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

async function frames(count: number) {
	for (let index = 0; index < count; index++) {
		clock.now += 1000 / 60;
		await act(async () => {
			const pending = [...clock.frames.values()];
			clock.frames.clear();
			for (const callback of pending) callback(clock.now);
		});
	}
}

afterEach(async () => {
	await act(async () => root.unmount());
	await frames(3);
	container.remove();
	vi.restoreAllMocks();
});

afterAll(() => vi.unstubAllGlobals());

function Categories({
	page,
	expanded = false,
}: {
	page: Page;
	expanded?: boolean;
}) {
	return (
		<CustomizePillSelector
			page={page}
			value="plugins"
			aria-label={`${page} categories`}
		>
			{categories[page].map(([category, left, width]) => (
				<CustomizePillSelectorItem
					key={category}
					category={category}
					value={category}
					data-left={left + (expanded && left >= 330 ? 30 : 0)}
					data-top={80}
					data-width={width + (expanded && category === "tools" ? 30 : 0)}
				>
					{category} <span>{expanded ? 1000 : 2}</span>
				</CustomizePillSelectorItem>
			))}
		</CustomizePillSelector>
	);
}

async function render(page: Page, expanded = false, withProvider = true) {
	await act(async () =>
		root.render(
			<StrictMode>
				{withProvider ? (
					<CustomizeCategoryTransitionProvider view={page}>
						<Categories key={page} page={page} expanded={expanded} />
					</CustomizeCategoryTransitionProvider>
				) : (
					<Categories key={page} page={page} expanded={expanded} />
				)}
			</StrictMode>,
		),
	);
}

function pill(category: string) {
	const element = container.querySelector<HTMLElement>(
		`[data-customize-category="${category}"]`,
	);
	if (!element) throw new Error(`Missing ${category} pill`);
	return element;
}

function horizontalTranslation(element: HTMLElement) {
	return Number(
		element.style.transform.match(/translate(?:3d|X)?\((-?[\d.]+)/)?.[1] ?? 0,
	);
}

function horizontalScale(element: HTMLElement) {
	return Number(element.style.transform.match(/scale\((-?[\d.]+)/)?.[1] ?? 1);
}

function verticalTranslation(element: HTMLElement) {
	return Number(
		element.style.transform.match(
			/translate(?:3d)?\([^,]+,\s*(-?[\d.]+)/,
		)?.[1] ?? 0,
	);
}

function expectStationary(category: string) {
	const element = pill(category);
	expect(horizontalTranslation(element)).toBe(0);
	expect(verticalTranslation(element)).toBe(0);
	expect(horizontalScale(element)).toBe(1);
}

describe("Customize category layout animations", () => {
	it("uses shared geometry across remounted category bars under StrictMode", async () => {
		await render("browse");
		await frames(3);
		expect(horizontalTranslation(pill("plugins"))).toBe(0);
		await render("manage");
		expectStationary("all");
		expectStationary("connectors");
		await frames(1);
		expectStationary("all");
		expectStationary("connectors");
		await frames(1);
		for (const category of ["plugins", "skills", "mcp"]) {
			expect(horizontalTranslation(pill(category))).toBeLessThan(0);
		}
		for (let frame = 0; frame < 25; frame++) {
			expectStationary("all");
			expectStationary("connectors");
			await frames(1);
		}
		await frames(80);
		expect(horizontalTranslation(pill("plugins"))).toBe(0);
		await render("browse");
		expectStationary("all");
		expectStationary("connectors");
		await frames(1);
		expectStationary("all");
		expectStationary("connectors");
		await frames(1);
		for (const category of ["plugins", "skills", "mcp"]) {
			expect(horizontalTranslation(pill(category))).toBeGreaterThan(0);
		}
		for (let frame = 0; frame < 25; frame++) {
			expectStationary("all");
			expectStationary("connectors");
			await frames(1);
		}
	});

	it("animates late count-driven changes after the page transition has finished", async () => {
		await render("browse");
		await frames(3);
		await render("manage");
		await frames(80);
		expect(horizontalTranslation(pill("plugins"))).toBe(0);
		await render("manage", true);
		await frames(2);
		expect(pill("tools").textContent).toContain("1000");
		expect(horizontalTranslation(pill("plugins"))).toBeLessThan(0);
		expect(horizontalScale(pill("tools"))).toBe(1);
		await frames(80);
		expect(horizontalTranslation(pill("plugins"))).toBe(0);
	});

	it("keeps standalone selectors usable without shared layout transitions", async () => {
		await render("browse", false, false);
		await frames(3);
		await render("manage", false, false);
		await frames(2);
		expect(horizontalTranslation(pill("plugins"))).toBe(0);
		expect(pill("plugins").getAttribute("aria-checked")).toBe("true");
	});

	it.each([
		"details",
		"search",
	] as const)("restores horizontal category scrolling after returning from %s", async (destination) => {
		vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
			function (this: HTMLElement) {
				return (this.isConnected && !this.closest("[hidden]")
					? [this.getBoundingClientRect()]
					: []) as unknown as DOMRectList;
			},
		);
		const renderDestination = async (away: boolean) => {
			await act(async () =>
				root.render(
					<CustomizeCategoryTransitionProvider view={away ? null : "browse"}>
						<div hidden={away && destination === "details"}>
							{!away || destination === "details" ? (
								<Categories page="browse" />
							) : null}
						</div>
					</CustomizeCategoryTransitionProvider>,
				),
			);
		};
		await renderDestination(false);
		const scroller = container.querySelector<HTMLElement>(
			'[data-slot="pill-selector"]',
		);
		if (!scroller) throw new Error("Missing pill selector scroller");
		let offset = 0;
		Object.defineProperty(scroller, "scrollLeft", {
			configurable: true,
			get: () => (scroller.closest("[hidden]") ? 0 : offset),
			set: (value: number) => {
				offset = value;
			},
		});
		await act(async () => {
			scroller.scrollLeft = 240;
			scroller.dispatchEvent(new Event("scroll"));
		});
		await renderDestination(true);
		// Simulate a browser resetting the now-hidden or detached scroll box.
		await act(async () => {
			scroller.scrollLeft = 0;
			scroller.dispatchEvent(new Event("scroll"));
		});
		await renderDestination(false);
		expect(
			container.querySelector<HTMLElement>('[data-slot="pill-selector"]')
				?.scrollLeft,
		).toBe(240);
		expect(pill("plugins").getAttribute("aria-checked")).toBe("true");
	});

	it("honors reduced motion while still updating the selected category", async () => {
		clock.reducedMotion = true;
		for (const listener of clock.mediaListeners) listener();
		await render("browse");
		await frames(3);
		await render("manage");
		await frames(2);
		expect(horizontalTranslation(pill("plugins"))).toBe(0);
		expect(horizontalScale(pill("plugins"))).toBe(1);
		expect(pill("plugins").getAttribute("aria-checked")).toBe("true");
	});
});
