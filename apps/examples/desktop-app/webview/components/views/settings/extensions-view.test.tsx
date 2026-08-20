// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CustomizationSectionView,
	invalidateExtensionListsCache,
} from "./extensions-view";
import {
	generateMediaConfig,
	imageMediaConfiguration,
} from "./generate-media-tool.test-fixtures";

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
