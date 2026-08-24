// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WELCOME_HERO_POINTER_CONFIG } from "./hero-config";
import { WelcomeHero, type WelcomeHeroProps } from "./welcome-hero";

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

async function renderHero(
	props: WelcomeHeroProps = {},
): Promise<HTMLDivElement> {
	await act(async () => root.render(<WelcomeHero {...props} />));
	const hero = container.querySelector<HTMLDivElement>("[data-welcome-hero]");
	expect(hero).not.toBeNull();
	return hero as HTMLDivElement;
}

describe("WelcomeHero", () => {
	it("renders independently tunable illustration layers", async () => {
		const hero = await renderHero();

		expect(hero.getAttribute("aria-hidden")).toBe("true");
		expect(hero.dataset.welcomeHeroInteractive).toBe("true");
		expect(hero.dataset.welcomeHeroLayout).toBe("default");
		expect(hero.dataset.welcomeHeroVariant).toBe("full");
		expect(
			hero.querySelector('[data-welcome-hero-layer="grid"]'),
		).not.toBeNull();
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

	it("renders a static grid without bot layers", async () => {
		const hero = await renderHero({ variant: "grid-only" });
		const getBoundingClientRect = vi.spyOn(hero, "getBoundingClientRect");

		expect(hero.dataset.welcomeHeroVariant).toBe("grid-only");
		expect(hero.dataset.welcomeHeroInteractive).toBe("false");
		expect(
			hero.querySelector('[data-welcome-hero-layer="grid"]'),
		).not.toBeNull();
		expect(hero.querySelector('[data-welcome-hero-layer="inner"]')).toBeNull();
		expect(
			hero.querySelector('[data-welcome-hero-layer="bot-fill"]'),
		).toBeNull();
		expect(hero.querySelectorAll("[data-welcome-hero-eye]")).toHaveLength(0);

		await act(async () => {
			window.dispatchEvent(
				new MouseEvent("pointermove", { clientX: 100, clientY: 100 }),
			);
		});

		expect(getBoundingClientRect).not.toHaveBeenCalled();
		expect(animationFrames).toHaveLength(0);
		expect(hero.style.getPropertyValue("--welcome-grid-x")).toBe("");
	});

	it("renders bot layers without the inline grid", async () => {
		const hero = await renderHero({ variant: "bot-only" });

		expect(hero.dataset.welcomeHeroVariant).toBe("bot-only");
		expect(hero.dataset.welcomeHeroInteractive).toBe("true");
		expect(hero.querySelector('[data-welcome-hero-layer="grid"]')).toBeNull();
		expect(
			hero.querySelector('[data-welcome-hero-layer="bot-fill"]'),
		).not.toBeNull();
		expect(hero.querySelectorAll("[data-welcome-hero-eye]")).toHaveLength(2);
	});

	it("tracks the pointer for an interactive grid without rendering the bot", async () => {
		const hero = await renderHero({ interactive: true, variant: "grid-only" });
		const grid = hero.querySelector<HTMLElement>(
			'[data-welcome-hero-layer="grid"]',
		);
		hero.getBoundingClientRect = vi.fn(
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
		if (!grid) throw new Error("Expected the grid layer to render");
		grid.getBoundingClientRect = vi.fn(
			() =>
				({
					bottom: 720,
					height: 700,
					left: 10,
					right: 940,
					top: 20,
					width: 930,
					x: 10,
					y: 20,
					toJSON: () => ({}),
				}) as DOMRect,
		);

		expect(hero.dataset.welcomeHeroInteractive).toBe("true");
		expect(hero.querySelectorAll("[data-welcome-hero-eye]")).toHaveLength(0);

		await act(async () => {
			window.dispatchEvent(
				new MouseEvent("pointermove", { clientX: -100, clientY: 500 }),
			);
			animationFrames.shift()?.(0);
		});

		expect(hero.style.getPropertyValue("--welcome-grid-x")).toBe("0.00%");
		expect(hero.style.getPropertyValue("--welcome-grid-y")).toBe("68.57%");
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
				WELCOME_HERO_POINTER_CONFIG.defaultFrameHeight +
					(WELCOME_HERO_POINTER_CONFIG.defaultGridHeight -
						WELCOME_HERO_POINTER_CONFIG.defaultFrameHeight) /
						2
			).toFixed(2)}px`,
		);
		expect(hero.style.getPropertyValue("--welcome-eye-x")).toMatch(/^-/);
		expect(hero.style.getPropertyValue("--welcome-eye-y")).toMatch(/^\d/);
		expect(getBoundingClientRect).toHaveBeenCalledOnce();
	});

	it("clears pointer styles when interaction is disabled", async () => {
		const hero = await renderHero();
		hero.getBoundingClientRect = vi.fn(
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

		await act(async () => {
			window.dispatchEvent(
				new MouseEvent("pointermove", { clientX: 220, clientY: 120 }),
			);
			animationFrames.shift()?.(0);
		});

		expect(hero.style.getPropertyValue("--welcome-grid-x")).not.toBe("");
		expect(hero.style.getPropertyValue("--welcome-eye-x")).not.toBe("");

		const staticHero = await renderHero({ interactive: false });

		expect(staticHero).toBe(hero);
		expect(staticHero.style.getPropertyValue("--welcome-grid-x")).toBe("");
		expect(staticHero.style.getPropertyValue("--welcome-grid-y")).toBe("");
		expect(staticHero.style.getPropertyValue("--welcome-eye-x")).toBe("");
		expect(staticHero.style.getPropertyValue("--welcome-eye-y")).toBe("");
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
		expect(hero.style.getPropertyValue("--welcome-grid-x")).toBe("");
		expect(hero.style.getPropertyValue("--welcome-eye-x")).toBe("");
	});
});
