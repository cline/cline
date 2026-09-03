// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "@/lib/provider-schema";
import {
	CustomizationSectionView,
	GenerateMediaConfiguration,
	type GenerateMediaToolConfig,
	invalidateExtensionListsCache,
	type MediaTypeConfiguration,
} from "./extensions-view";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke },
}));

const emptyInstructionLists = {
	workspaceRoot: "/workspace",
	rules: [],
	workflows: [],
	skills: [],
	agents: [],
	plugins: [],
	hooks: [],
	mcp: {
		settingsPath: "",
		hasSettingsFile: false,
		servers: [],
	},
	warnings: [],
};

const eligibleProviders: Provider[] = [
	{
		id: "vercel-ai-gateway",
		name: "Vercel AI Gateway",
		models: 3,
		color: "#000000",
		letter: "VA",
		enabled: true,
		modelList: [
			{
				id: "imagen",
				name: "Imagen",
				operation: "image-generation",
				inputModalities: ["text"],
				outputModalities: ["image"],
			},
			{
				id: "mixed-image",
				name: "Mixed Image",
				operation: "language",
				inputModalities: ["text"],
				outputModalities: ["text", "image"],
			},
			{
				id: "chat-only",
				name: "Chat only",
				inputModalities: ["text"],
				outputModalities: ["text"],
			},
			{
				id: "audio-gen",
				name: "Audio Gen",
				operation: "speech-generation",
				inputModalities: ["text"],
				outputModalities: ["audio"],
			},
		],
	},
	{
		id: "custom-provider",
		name: "Custom provider",
		models: 1,
		color: "#111111",
		letter: "CP",
		enabled: true,
		modelList: [
			{
				id: "advertised-but-unsupported",
				name: "Advertised but unsupported",
				operation: "image-generation",
				inputModalities: ["text"],
				outputModalities: ["image"],
			},
		],
	},
	{
		id: "disabled-image-provider",
		name: "Disabled image provider",
		models: 1,
		color: "#222222",
		letter: "DI",
		enabled: false,
		modelList: [
			{
				id: "disabled-image",
				name: "Disabled image",
				operation: "image-generation",
				inputModalities: ["text"],
				outputModalities: ["image"],
			},
		],
	},
];

const mediaGenerationModels = {
	audio: {},
	image: {
		"vercel-ai-gateway": ["imagen", "mixed-image"],
		"custom-provider": [],
		"disabled-image-provider": ["disabled-image"],
	},
	video: {},
};

let container: HTMLDivElement;
let root: Root;

class ResizeObserverStub {
	disconnect() {}
	observe() {}
	unobserve() {}
}

beforeEach(() => {
	Object.assign(globalThis, {
		IS_REACT_ACT_ENVIRONMENT: true,
		ResizeObserver: ResizeObserverStub,
	});
	invoke.mockReset();
	invalidateExtensionListsCache();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

function generateMediaConfig(
	overrides: Partial<GenerateMediaToolConfig> = {},
): GenerateMediaToolConfig {
	return {
		error: null,
		loading: false,
		mediaTypes: [imageMediaConfiguration()],
		onChange: vi.fn(),
		onConfigureProviders: vi.fn(),
		providers: eligibleProviders,
		...overrides,
	};
}

function imageMediaConfiguration(
	selection?: MediaTypeConfiguration["selection"],
): MediaTypeConfiguration {
	return {
		mediaType: "image",
		modelIdsByProvider: mediaGenerationModels.image,
		saving: false,
		selection,
	};
}

describe("CustomizationSectionView Generate media tool", () => {
	it("keeps setup-required tools off and toggles configuration from the card", async () => {
		const disabledTool = {
			id: "generate_media",
			name: "generate_media",
			description: "Generate media from a prompt.",
			enabled: false,
			source: "builtin",
			headlessToolNames: ["generate_media"],
		};
		const enabledTool = { ...disabledTool, enabled: true };
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_user_instruction_configs") {
				return { ...emptyInstructionLists, tools: [enabledTool] };
			}
			throw new Error(`unexpected command: ${command}`);
		});

		await act(async () => {
			root.render(
				<CustomizationSectionView
					generateMediaConfig={generateMediaConfig()}
					section="Tools"
				/>,
			);
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});

		const toggle = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Toggle generate_media"]',
		);
		const cardTrigger = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Configure generate_media"]',
		);
		expect(toggle).not.toBeNull();
		expect(toggle?.getAttribute("data-state")).toBe("unchecked");
		expect(toggle?.disabled).toBe(true);
		expect(cardTrigger?.getAttribute("aria-expanded")).toBe("false");
		expect(container.textContent).toContain("Setup required");
		const setupStatus = Array.from(container.querySelectorAll("span")).find(
			(element) => element.textContent === "Setup required",
		);
		expect(setupStatus?.className).toContain("text-amber-600");
		expect(container.querySelector(".lucide-chevron-down")).toBeNull();
		expect(
			container.querySelector('[aria-label="Image generation provider"]'),
		).toBeNull();

		await act(async () => {
			cardTrigger?.click();
		});
		expect(cardTrigger?.getAttribute("aria-expanded")).toBe("true");
		expect(
			container.querySelector('[aria-label="Image generation provider"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[data-media-type-config="image"]')?.className,
		).not.toContain("border");
		expect(
			invoke.mock.calls.filter(([command]) => command === "set_tool_disabled"),
		).toHaveLength(0);

		await act(async () => {
			cardTrigger?.click();
		});
		expect(cardTrigger?.getAttribute("aria-expanded")).toBe("false");
		expect(
			container.querySelector('[aria-label="Image generation provider"]'),
		).toBeNull();
	});

	it("enables a configured tool without expanding its card", async () => {
		const disabledTool = {
			id: "generate_media",
			name: "generate_media",
			description: "Generate media from a prompt.",
			enabled: false,
			source: "builtin",
			headlessToolNames: ["generate_media"],
		};
		const enabledTool = { ...disabledTool, enabled: true };
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_user_instruction_configs") {
				return { ...emptyInstructionLists, tools: [disabledTool] };
			}
			if (command === "set_tool_disabled") {
				return { ...emptyInstructionLists, tools: [enabledTool] };
			}
			throw new Error(`unexpected command: ${command}`);
		});

		await act(async () => {
			root.render(
				<CustomizationSectionView
					generateMediaConfig={generateMediaConfig({
						mediaTypes: [
							imageMediaConfiguration({
								providerId: "vercel-ai-gateway",
								modelId: "imagen",
							}),
						],
					})}
					section="Tools"
				/>,
			);
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});

		const toggle = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Toggle generate_media"]',
		);
		expect(toggle?.disabled).toBe(false);
		expect(toggle?.getAttribute("data-state")).toBe("unchecked");
		expect(
			container.querySelector('[aria-label="Image generation provider"]'),
		).toBeNull();

		await act(async () => {
			toggle?.click();
		});
		expect(invoke.mock.calls).toContainEqual([
			"set_tool_disabled",
			{ names: ["generate_media"], disabled: false },
		]);
		expect(toggle?.getAttribute("data-state")).toBe("checked");
		expect(
			container.querySelector('[aria-label="Image generation provider"]'),
		).toBeNull();
	});

	it("blocks enablement while the provider catalog is refreshing", async () => {
		const disabledTool = {
			id: "generate_media",
			name: "generate_media",
			description: "Generate media from a prompt.",
			enabled: false,
			source: "builtin",
			headlessToolNames: ["generate_media"],
		};
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_user_instruction_configs") {
				return { ...emptyInstructionLists, tools: [disabledTool] };
			}
			throw new Error(`unexpected command: ${command}`);
		});

		await act(async () => {
			root.render(
				<CustomizationSectionView
					generateMediaConfig={generateMediaConfig({
						loading: true,
						mediaTypes: [
							imageMediaConfiguration({
								providerId: "vercel-ai-gateway",
								modelId: "imagen",
							}),
						],
					})}
					section="Tools"
				/>,
			);
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});

		const toggle = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Toggle generate_media"]',
		);
		expect(toggle?.disabled).toBe(true);
		expect(container.textContent).toContain("Checking setup");
		act(() => toggle?.click());
		expect(invoke).not.toHaveBeenCalledWith(
			"set_tool_disabled",
			expect.anything(),
		);
	});

	it.each([
		[
			"disabled provider",
			{ providerId: "disabled-image-provider", modelId: "disabled-image" },
		],
		[
			"missing model",
			{ providerId: "vercel-ai-gateway", modelId: "removed-image-model" },
		],
		[
			"ineligible model",
			{ providerId: "vercel-ai-gateway", modelId: "chat-only" },
		],
	])("requires setup for a stale %s selection", async (_label, selection) => {
		const enabledTool = {
			id: "generate_media",
			name: "generate_media",
			description: "Generate media from a prompt.",
			enabled: true,
			source: "builtin",
			headlessToolNames: ["generate_media"],
		};
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_user_instruction_configs") {
				return { ...emptyInstructionLists, tools: [enabledTool] };
			}
			throw new Error(`unexpected command: ${command}`);
		});

		await act(async () => {
			root.render(
				<CustomizationSectionView
					generateMediaConfig={generateMediaConfig({
						mediaTypes: [imageMediaConfiguration(selection)],
					})}
					section="Tools"
				/>,
			);
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});

		const toggle = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Toggle generate_media"]',
		);
		expect(toggle?.getAttribute("data-state")).toBe("unchecked");
		expect(toggle?.disabled).toBe(true);
		expect(container.textContent).toContain("Setup required");
	});

	it("rolls back an optimistic toggle when the backend does not persist it", async () => {
		const disabledTool = {
			id: "generate_media",
			name: "generate_media",
			description: "Generate media from a prompt.",
			enabled: false,
			source: "builtin",
			headlessToolNames: ["generate_media"],
		};
		let resolveToggle: ((value: unknown) => void) | undefined;
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_user_instruction_configs") {
				return { ...emptyInstructionLists, tools: [disabledTool] };
			}
			if (command === "set_tool_disabled") {
				return await new Promise((resolve) => {
					resolveToggle = resolve;
				});
			}
			throw new Error(`unexpected command: ${command}`);
		});

		await act(async () => {
			root.render(
				<CustomizationSectionView
					generateMediaConfig={generateMediaConfig({
						mediaTypes: [
							imageMediaConfiguration({
								providerId: "vercel-ai-gateway",
								modelId: "imagen",
							}),
						],
					})}
					section="Tools"
				/>,
			);
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});
		const toggle = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Toggle generate_media"]',
		);

		act(() => toggle?.click());

		await act(async () => {
			resolveToggle?.({ ...emptyInstructionLists, tools: [disabledTool] });
			await Promise.resolve();
		});

		expect(toggle?.getAttribute("data-state")).toBe("unchecked");
		expect(container.textContent).toContain(
			"tool toggle did not persist the requested enabled state",
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
			Array.from(container.querySelectorAll("button"))
				.find((button) => button.textContent === "Save")
				?.click();
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
			Array.from(container.querySelectorAll("button"))
				.find((button) => button.textContent === "Save")
				?.click();
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
			Array.from(container.querySelectorAll("button"))
				.find((button) => button.textContent === "Save")
				?.click();
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
