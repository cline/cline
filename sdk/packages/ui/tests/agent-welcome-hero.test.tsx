// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	AgentWelcomeHero,
	type AgentWelcomeHeroProps,
} from "../components/index.js";

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
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
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

async function renderHero(props: AgentWelcomeHeroProps = {}) {
	await act(async () => root.render(<AgentWelcomeHero {...props} />));
	const hero = container.querySelector<HTMLDivElement>("[data-welcome-hero]");
	expect(hero).not.toBeNull();
	return hero as HTMLDivElement;
}

describe("AgentWelcomeHero", () => {
	it("renders the full bot and grid by default", async () => {
		const hero = await renderHero();

		expect(hero.getAttribute("aria-hidden")).toBe("true");
		expect(hero.dataset.welcomeHeroInteractive).toBe("true");
		expect(hero.dataset.welcomeHeroLayout).toBe("default");
		expect(hero.dataset.welcomeHeroVariant).toBe("full");
		expect(
			hero.querySelector('[data-welcome-hero-layer="grid"]'),
		).not.toBeNull();
		expect(hero.querySelectorAll("[data-welcome-hero-eye]")).toHaveLength(2);
	});

	it("supports grid-only and bot-only variants", async () => {
		const grid = await renderHero({ variant: "grid-only" });
		expect(grid.dataset.welcomeHeroInteractive).toBe("false");
		expect(grid.querySelectorAll("[data-welcome-hero-eye]")).toHaveLength(0);

		const bot = await renderHero({ variant: "bot-only" });
		expect(bot.querySelector('[data-welcome-hero-layer="grid"]')).toBeNull();
		expect(bot.querySelectorAll("[data-welcome-hero-eye]")).toHaveLength(2);
	});

	it("tracks the pointer", async () => {
		const hero = await renderHero();
		hero.getBoundingClientRect = vi.fn(
			() =>
				({
					height: 220,
					left: 10,
					top: 20,
					width: 930,
				}) as DOMRect,
		);

		await act(async () => {
			window.dispatchEvent(
				new MouseEvent("pointermove", { clientX: -100, clientY: 500 }),
			);
			animationFrames.shift()?.(0);
		});

		expect(hero.style.getPropertyValue("--welcome-grid-x")).toBe("0.00%");
		expect(hero.style.getPropertyValue("--welcome-grid-y")).toBe("370.00px");
		expect(hero.style.getPropertyValue("--welcome-eye-x")).toMatch(/^-/);
	});

	it("does not track the pointer with reduced motion", async () => {
		reducedMotion = true;
		const hero = await renderHero();
		const bounds = vi.spyOn(hero, "getBoundingClientRect");

		await act(async () => {
			window.dispatchEvent(
				new MouseEvent("pointermove", { clientX: 100, clientY: 100 }),
			);
		});

		expect(bounds).not.toHaveBeenCalled();
		expect(animationFrames).toHaveLength(0);
	});
});
