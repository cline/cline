// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	GenerateMediaConfiguration,
	GenerateMediaToolCard,
	hasConfiguredMediaSelection,
	isValidMediaSelection,
	type MediaTypeConfiguration,
} from "./generate-media-tool";
import {
	eligibleProviders,
	generateMediaConfig,
	imageMediaConfiguration,
} from "./generate-media-tool.test-fixtures";

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

describe("isValidMediaSelection", () => {
	it("accepts a selection that is enabled, cataloged, and listed by the provider", () => {
		const config = generateMediaConfig();
		expect(
			isValidMediaSelection(
				config,
				imageMediaConfiguration({
					providerId: "vercel-ai-gateway",
					modelId: "imagen",
				}),
			),
		).toBe(true);
	});

	it("rejects a missing selection", () => {
		const config = generateMediaConfig();
		expect(isValidMediaSelection(config, imageMediaConfiguration())).toBe(
			false,
		);
	});

	it("rejects a selection on a disabled provider", () => {
		const config = generateMediaConfig();
		expect(
			isValidMediaSelection(
				config,
				imageMediaConfiguration({
					providerId: "disabled-image-provider",
					modelId: "disabled-image",
				}),
			),
		).toBe(false);
	});

	it("rejects a model missing from the authoritative catalog even when advertised", () => {
		const config = generateMediaConfig();
		expect(
			isValidMediaSelection(
				config,
				imageMediaConfiguration({
					providerId: "custom-provider",
					modelId: "advertised-but-unsupported",
				}),
			),
		).toBe(false);
	});

	it("rejects a cataloged model the provider no longer lists", () => {
		const config = generateMediaConfig({
			providers: eligibleProviders.map((provider) =>
				provider.id === "vercel-ai-gateway"
					? {
							...provider,
							modelList: provider.modelList?.filter(
								(model) => model.id !== "imagen",
							),
						}
					: provider,
			),
		});
		expect(
			isValidMediaSelection(
				config,
				imageMediaConfiguration({
					providerId: "vercel-ai-gateway",
					modelId: "imagen",
				}),
			),
		).toBe(false);
	});
});

describe("hasConfiguredMediaSelection", () => {
	it("is false without a config", () => {
		expect(hasConfiguredMediaSelection(undefined)).toBe(false);
	});

	it("is false when no media type has a valid selection", () => {
		expect(hasConfiguredMediaSelection(generateMediaConfig())).toBe(false);
	});

	it("is true when at least one media type has a valid selection", () => {
		expect(
			hasConfiguredMediaSelection(
				generateMediaConfig({
					mediaTypes: [
						imageMediaConfiguration(),
						imageMediaConfiguration({
							providerId: "vercel-ai-gateway",
							modelId: "imagen",
						}),
					],
				}),
			),
		).toBe(true);
	});
});

describe("GenerateMediaToolCard", () => {
	const summary = <span>generate_media summary</span>;

	it("keeps the switch off and disabled until setup completes, and expands from the summary", async () => {
		const onToggle = vi.fn();
		await act(async () => {
			root.render(
				<GenerateMediaToolCard
					config={generateMediaConfig()}
					enabled={true}
					onToggle={onToggle}
					summary={summary}
					toggling={false}
					toolId="generate_media"
					toolName="generate_media"
				/>,
			);
		});

		const toggle = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Toggle generate_media"]',
		);
		const trigger = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Configure generate_media"]',
		);
		expect(toggle?.getAttribute("data-state")).toBe("unchecked");
		expect(toggle?.disabled).toBe(true);
		expect(container.textContent).toContain("Setup required");
		expect(trigger?.getAttribute("aria-expanded")).toBe("false");
		expect(
			container.querySelector('[aria-label="Image generation provider"]'),
		).toBeNull();

		await act(async () => {
			trigger?.click();
		});
		expect(trigger?.getAttribute("aria-expanded")).toBe("true");
		expect(
			container.querySelector('[aria-label="Image generation provider"]'),
		).not.toBeNull();

		await act(async () => {
			trigger?.click();
		});
		expect(trigger?.getAttribute("aria-expanded")).toBe("false");
		expect(
			container.querySelector('[aria-label="Image generation provider"]'),
		).toBeNull();
		expect(onToggle).not.toHaveBeenCalled();
	});

	it("reports Checking setup and blocks toggling while the catalog is loading", async () => {
		const onToggle = vi.fn();
		await act(async () => {
			root.render(
				<GenerateMediaToolCard
					config={generateMediaConfig({
						loading: true,
						mediaTypes: [
							imageMediaConfiguration({
								providerId: "vercel-ai-gateway",
								modelId: "imagen",
							}),
						],
					})}
					enabled={false}
					onToggle={onToggle}
					summary={summary}
					toggling={false}
					toolId="generate_media"
					toolName="generate_media"
				/>,
			);
		});

		const toggle = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Toggle generate_media"]',
		);
		expect(container.textContent).toContain("Checking setup");
		expect(toggle?.disabled).toBe(true);
		act(() => toggle?.click());
		expect(onToggle).not.toHaveBeenCalled();
	});

	it("enables the switch when a valid selection exists and forwards toggles", async () => {
		const onToggle = vi.fn();
		await act(async () => {
			root.render(
				<GenerateMediaToolCard
					config={generateMediaConfig({
						mediaTypes: [
							imageMediaConfiguration({
								providerId: "vercel-ai-gateway",
								modelId: "imagen",
							}),
						],
					})}
					enabled={false}
					onToggle={onToggle}
					summary={summary}
					toggling={false}
					toolId="generate_media"
					toolName="generate_media"
				/>,
			);
		});

		const toggle = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Toggle generate_media"]',
		);
		expect(toggle?.disabled).toBe(false);
		expect(container.textContent).toContain("Disabled");
		act(() => toggle?.click());
		expect(onToggle).toHaveBeenCalledWith(true);
	});

	it("points to desktop settings when no configuration boundary is provided", async () => {
		await act(async () => {
			root.render(
				<GenerateMediaToolCard
					enabled={false}
					onToggle={vi.fn()}
					summary={summary}
					toggling={false}
					toolId="generate_media"
					toolName="generate_media"
				/>,
			);
		});

		const trigger = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Configure generate_media"]',
		);
		await act(async () => {
			trigger?.click();
		});
		expect(container.textContent).toContain(
			"Open the desktop Tools settings to configure an eligible media provider and model.",
		);
	});
});

describe("GenerateMediaConfiguration", () => {
	it("uses the authoritative catalog and reports provider, model, and clear selections", async () => {
		const onChange = vi.fn();
		const render = async (selection?: MediaTypeConfiguration["selection"]) => {
			await act(async () => {
				root.render(
					<GenerateMediaConfiguration
						config={generateMediaConfig({
							mediaTypes: [imageMediaConfiguration(selection)],
							onChange,
						})}
					/>,
				);
			});
		};

		await render();
		const providerSelect = container.querySelector<HTMLSelectElement>(
			'[aria-label="Image generation provider"]',
		);
		expect(
			Array.from(providerSelect?.options ?? []).map((option) => option.value),
		).toEqual(["", "vercel-ai-gateway"]);

		await act(async () => {
			if (!providerSelect) return;
			providerSelect.value = "vercel-ai-gateway";
			providerSelect.dispatchEvent(new Event("change", { bubbles: true }));
		});
		expect(onChange).toHaveBeenLastCalledWith("image", {
			providerId: "vercel-ai-gateway",
			modelId: "imagen",
		});

		await render({ providerId: "vercel-ai-gateway", modelId: "imagen" });
		const modelSelect = container.querySelector<HTMLSelectElement>(
			'[aria-label="Image generation model"]',
		);
		expect(
			Array.from(modelSelect?.options ?? []).map((option) => option.value),
		).toEqual(["imagen", "mixed-image"]);

		await act(async () => {
			if (!modelSelect) return;
			modelSelect.value = "mixed-image";
			modelSelect.dispatchEvent(new Event("change", { bubbles: true }));
		});
		expect(onChange).toHaveBeenLastCalledWith("image", {
			providerId: "vercel-ai-gateway",
			modelId: "mixed-image",
		});

		const configuredProviderSelect = container.querySelector<HTMLSelectElement>(
			'[aria-label="Image generation provider"]',
		);
		await act(async () => {
			if (!configuredProviderSelect) return;
			configuredProviderSelect.value = "";
			configuredProviderSelect.dispatchEvent(
				new Event("change", { bubbles: true }),
			);
		});
		expect(onChange).toHaveBeenLastCalledWith("image", undefined);
	});

	it("links to provider setup when no eligible image provider exists", async () => {
		const onConfigureProviders = vi.fn();
		await act(async () => {
			root.render(
				<GenerateMediaConfiguration
					config={generateMediaConfig({
						onConfigureProviders,
						providers: eligibleProviders.filter(
							(provider) => provider.id !== "vercel-ai-gateway",
						),
					})}
				/>,
			);
		});

		expect(container.textContent).toContain(
			"Configure and enable a provider with an eligible image-generation model",
		);
		const configureButton = Array.from(
			container.querySelectorAll<HTMLButtonElement>("button"),
		).find((button) => button.textContent?.includes("Configure providers"));
		expect(configureButton).not.toBeUndefined();

		await act(async () => {
			configureButton?.click();
		});
		expect(onConfigureProviders).toHaveBeenCalledOnce();
	});

	it("renders each media type independently", async () => {
		await act(async () => {
			root.render(
				<GenerateMediaConfiguration
					config={generateMediaConfig({
						mediaTypes: [
							{
								mediaType: "image",
								modelIdsByProvider: {},
								saving: false,
							},
							{
								mediaType: "audio",
								modelIdsByProvider: {
									"vercel-ai-gateway": ["audio-gen"],
								},
								saving: false,
							},
						],
					})}
				/>,
			);
		});

		expect(container.textContent).toContain("Image generation");
		expect(container.textContent).toContain("Audio generation");
		expect(
			container.querySelector('[aria-label="Image generation provider"]'),
		).toBeNull();
		expect(
			container.querySelector('[aria-label="Audio generation provider"]'),
		).not.toBeNull();
	});
});
