// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	APP_FONT_SIZE_STORAGE_KEY,
	applyAppZoomAction,
} from "@/lib/app-font-size";
import { isProviderCatalogFresh, SettingsView } from "./settings-view";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke },
	isTauriAvailable: vi.fn(() => false),
	openExternalUrl: vi.fn(),
}));

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
	window.localStorage.clear();
	document.documentElement.style.removeProperty("font-size");
	delete document.documentElement.dataset.clineFontSize;
	invoke.mockReset();
	invoke.mockResolvedValue({
		telemetryOptOut: false,
		autoUpdateEnabled: true,
	});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("SettingsView font size", () => {
	it("loads the saved size and updates it from the General settings controls", async () => {
		window.localStorage.setItem(APP_FONT_SIZE_STORAGE_KEY, "17");

		await act(async () => {
			root.render(
				<SettingsView onNavigateSection={vi.fn()} section="General" />,
			);
		});

		const slider = container.querySelector<HTMLElement>(
			'[role="slider"][aria-label="Font size"]',
		);
		const increaseButton = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Increase font size"]',
		);
		expect(slider?.getAttribute("aria-valuenow")).toBe("17");
		expect(increaseButton).not.toBeNull();
		expect(increaseButton?.disabled).toBe(false);
		expect(container.textContent).toContain("17px");

		await act(async () => {
			increaseButton?.click();
		});

		expect(window.localStorage.getItem(APP_FONT_SIZE_STORAGE_KEY)).toBe("18");
		expect(document.documentElement.style.fontSize).toBe("18px");
		const updatedSlider = container.querySelector<HTMLElement>(
			'[role="slider"][aria-label="Font size"]',
		);
		expect(updatedSlider).toBe(slider);
		expect(updatedSlider?.getAttribute("aria-valuenow")).toBe("18");

		await act(async () => {
			updatedSlider?.focus();
			updatedSlider?.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
			);
		});

		expect(window.localStorage.getItem(APP_FONT_SIZE_STORAGE_KEY)).toBe("19");
		expect(document.documentElement.style.fontSize).toBe("19px");
		expect(updatedSlider?.getAttribute("aria-valuenow")).toBe("19");

		await act(async () => {
			applyAppZoomAction("zoom-in");
		});

		expect(window.localStorage.getItem(APP_FONT_SIZE_STORAGE_KEY)).toBe("20");
		expect(container.textContent).toContain("20px");
		expect(updatedSlider?.getAttribute("aria-valuenow")).toBe("20");
		expect(increaseButton?.disabled).toBe(true);
	});
});

describe("SettingsView generate media configuration", () => {
	it("treats expired cached provider catalogs as loading", () => {
		expect(isProviderCatalogFresh(1_000, 60_999)).toBe(true);
		expect(isProviderCatalogFresh(1_000, 61_000)).toBe(false);
		expect(isProviderCatalogFresh(undefined, 61_000)).toBe(false);
	});

	it("loads Tools provider data, expands from the card, and saves before enabling", async () => {
		const disabledTool = {
			id: "generate_media",
			name: "generate_media",
			description: "Generate media from a prompt.",
			enabled: false,
			source: "builtin",
			headlessToolNames: ["generate_media"],
		};
		const emptyInstructionLists = {
			workspaceRoot: "/workspace",
			rules: [],
			workflows: [],
			skills: [],
			agents: [],
			plugins: [],
			hooks: [],
			mcp: { settingsPath: "", hasSettingsFile: false, servers: [] },
			warnings: [],
		};
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_user_instruction_configs") {
				return { ...emptyInstructionLists, tools: [disabledTool] };
			}
			if (command === "list_provider_catalog") {
				return {
					providers: [
						{
							id: "google",
							name: "Google",
							models: 1,
							color: "#4285f4",
							letter: "G",
							enabled: true,
							modelList: [
								{
									id: "gemini-image",
									name: "Gemini Image",
									operation: "image-generation",
									inputModalities: ["text"],
									outputModalities: ["image"],
								},
							],
						},
					],
					settingsPath: "/settings/providers.json",
					mediaGenerationModels: {
						audio: {},
						image: { google: ["gemini-image"] },
						video: {},
					},
				};
			}
			if (command === "set_tool_disabled") {
				return {
					...emptyInstructionLists,
					tools: [{ ...disabledTool, enabled: true }],
				};
			}
			if (command === "save_media_generation_settings") {
				return {
					mediaGeneration: {
						image: { providerId: "google", modelId: "gemini-image" },
					},
				};
			}
			throw new Error(`unexpected command: ${command}`);
		});

		await act(async () => {
			root.render(<SettingsView onNavigateSection={vi.fn()} section="Tools" />);
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
		});

		const toggle = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Toggle generate_media"]',
		);
		expect(toggle).not.toBeNull();
		expect(toggle?.disabled).toBe(true);
		const cardTrigger = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Configure generate_media"]',
		);
		act(() => cardTrigger?.click());

		const providerSelect = container.querySelector<HTMLSelectElement>(
			'[aria-label="Image generation provider"]',
		);
		expect(providerSelect).not.toBeNull();
		await act(async () => {
			if (!providerSelect) return;
			providerSelect.value = "google";
			providerSelect.dispatchEvent(new Event("change", { bubbles: true }));
			await Promise.resolve();
		});

		expect(invoke).toHaveBeenCalledWith("save_media_generation_settings", {
			media_type: "image",
			provider: "google",
			model: "gemini-image",
		});
		expect(toggle?.disabled).toBe(false);
		expect(toggle?.getAttribute("data-state")).toBe("unchecked");

		await act(async () => {
			toggle?.click();
		});
		expect(invoke).toHaveBeenCalledWith("set_tool_disabled", {
			names: ["generate_media"],
			disabled: false,
		});
		expect(toggle?.getAttribute("data-state")).toBe("checked");
	});
});
