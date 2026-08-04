// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "@/lib/provider-schema";
import { ProviderDetailContent } from "./provider-list-view";

const provider: Provider = {
	id: "ollama",
	name: "Ollama",
	models: 2,
	color: "#000",
	letter: "OL",
	enabled: true,
	modelList: [
		{ id: "alpha", name: "Alpha" },
		{ id: "beta", name: "Beta" },
	],
};

describe("ProviderDetailContent models", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		window.localStorage.clear();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	it("persists favorites, sorts them first, and adds models", async () => {
		const onUpdateModels = vi.fn();
		await act(async () => {
			root.render(
				<ProviderDetailContent
					modelsError={null}
					onBack={vi.fn()}
					onLoadModels={vi.fn()}
					onUpdate={vi.fn()}
					onUpdateModels={onUpdateModels}
					provider={provider}
				/>,
			);
		});

		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('[aria-label="Favorite Beta"]')
				?.click();
		});
		expect(
			Array.from(
				container.querySelectorAll<HTMLButtonElement>(
					'[aria-label^="Copy model ID"]',
				),
			).map((button) => button.getAttribute("aria-label")),
		).toEqual(["Copy model ID beta", "Copy model ID alpha"]);
		expect(
			container.querySelector('[aria-label="Unfavorite Beta"] svg')?.classList,
		).toContain("fill-current");

		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('[aria-label="Add model"]')
				?.click();
		});
		const input = container.querySelector<HTMLInputElement>(
			'[aria-label="New model ID"]',
		);
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set;
			setter?.call(input, "gamma");
			input?.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await act(async () => {
			container
				.querySelector<HTMLButtonElement>(
					'[aria-label="New model ID"] + button',
				)
				?.click();
		});
		expect(onUpdateModels).toHaveBeenCalledWith(["alpha", "beta", "gamma"]);
	});
});
