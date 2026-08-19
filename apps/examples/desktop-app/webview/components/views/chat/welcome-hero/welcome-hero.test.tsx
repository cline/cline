// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WELCOME_HERO_CONFIG } from "./hero-config";
import { WelcomeHero } from "./welcome-hero";

let container: HTMLDivElement;
let root: Root;
let animationFrames: FrameRequestCallback[];
let reducedMotion = false;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	animationFrames = [];
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		animationFrames.push(callback);
		return animationFrames.length;
	});
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({
			matches: reducedMotion,
			media: "(prefers-reduced-motion: reduce)",
			onchange: null,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			addListener: vi.fn(),
			removeListener: vi.fn(),
			dispatchEvent: vi.fn(() => true),
		})),
	);
	reducedMotion = false;
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

async function renderHero(): Promise<HTMLDivElement> {
	await act(async () => root.render(<WelcomeHero />));
	const hero = container.querySelector<HTMLDivElement>("[data-welcome-hero]");
	expect(hero).not.toBeNull();
	return hero as HTMLDivElement;
}

describe("WelcomeHero", () => {
	it("renders independently tunable illustration layers", async () => {
		const hero = await renderHero();

		expect(hero.getAttribute("aria-hidden")).toBe("true");
		expect(
			hero.querySelector('[data-welcome-hero-layer="inner"]'),
		).not.toBeNull();
		expect(
			hero.querySelector('[data-welcome-hero-layer="bot-fill"]'),
		).not.toBeNull();
		expect(
			hero.querySelector('[data-welcome-hero-layer="bot-outline"]'),
		).not.toBeNull();
		expect(hero.querySelectorAll("[data-welcome-hero-eye]")).toHaveLength(2);
	});

	it("tracks the page pointer and holds the reveal at the nearest edge", async () => {
		const hero = await renderHero();
		const getBoundingClientRect = vi.fn(
			() =>
				({
					bottom: 240,
					height: 220,
					left: 10,
					right: 940,
					top: 20,
					width: 930,
					x: 10,
					y: 20,
					toJSON: () => ({}),
				}) as DOMRect,
		);
		hero.getBoundingClientRect = getBoundingClientRect;

		await act(async () => {
			window.dispatchEvent(
				new MouseEvent("pointermove", {
					clientX: -100,
					clientY: 500,
				}),
			);
			animationFrames.shift()?.(0);
		});

		expect(hero.style.getPropertyValue("--welcome-grid-x")).toBe("0.00%");
		expect(hero.style.getPropertyValue("--welcome-grid-y")).toBe(
			`${(
				WELCOME_HERO_CONFIG.frame.height +
					(WELCOME_HERO_CONFIG.grid.height - WELCOME_HERO_CONFIG.frame.height) /
						2
			).toFixed(2)}px`,
		);
		expect(hero.style.getPropertyValue("--welcome-eye-x")).toMatch(/^-/);
		expect(hero.style.getPropertyValue("--welcome-eye-y")).toMatch(/^\d/);
		expect(getBoundingClientRect).toHaveBeenCalledOnce();
	});

	it("does not track the pointer when reduced motion is requested", async () => {
		reducedMotion = true;
		const hero = await renderHero();
		const getBoundingClientRect = vi.spyOn(hero, "getBoundingClientRect");

		await act(async () => {
			window.dispatchEvent(
				new MouseEvent("pointermove", { clientX: 100, clientY: 100 }),
			);
		});

		expect(getBoundingClientRect).not.toHaveBeenCalled();
		expect(animationFrames).toHaveLength(0);
		expect(hero.style.getPropertyValue("--welcome-grid-x")).toBe("50%");
		expect(hero.style.getPropertyValue("--welcome-eye-x")).toBe("0px");
	});
});
