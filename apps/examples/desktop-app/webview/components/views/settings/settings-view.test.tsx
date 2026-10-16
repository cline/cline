// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	APP_FONT_SIZE_STORAGE_KEY,
	applyAppZoomAction,
} from "@/lib/app-font-size";
import { invalidateProviderCatalogCache } from "@/lib/provider-model-catalog";
import type {
	ProviderCatalogResponse,
	ProviderModelsResponse,
} from "@/lib/provider-schema";
import { SettingsView } from "./settings-view";

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
	if (typeof window.localStorage.clear !== "function") {
		Object.defineProperty(window, "localStorage", {
			configurable: true,
			value: window.sessionStorage,
		});
	}
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
	await act(async () => {
		invalidateProviderCatalogCache();
		root.unmount();
	});
	container.remove();
});

describe("SettingsView font size", () => {
	it("loads the saved size and updates it from the General settings controls", async () => {
		window.localStorage.setItem(APP_FONT_SIZE_STORAGE_KEY, "17");

		await act(async () => {
			root.render(
				<SettingsView
					onExportDiagnostics={vi.fn()}
					onNavigateSection={vi.fn()}
					section="General"
				/>,
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

describe("SettingsView provider catalog invalidation", () => {
	it("refreshes the configured badge and count after connecting a provider", async () => {
		let resolveSavedCatalog:
			| ((catalog: ProviderCatalogResponse) => void)
			| undefined;
		let settingsSaved = false;
		const catalog = (configured: boolean): ProviderCatalogResponse => ({
			providers: [
				{
					id: "ollama",
					name: "Ollama",
					models: null,
					color: "",
					letter: "O",
					enabled: configured,
					configured,
				},
			],
			settingsPath: "/tmp/providers.json",
		});

		invoke.mockImplementation(async (command: string) => {
			if (command === "list_provider_catalog") {
				if (!settingsSaved) return catalog(false);
				return new Promise<ProviderCatalogResponse>((resolve) => {
					resolveSavedCatalog = resolve;
				});
			}
			if (command === "save_provider_settings") {
				settingsSaved = true;
				return {};
			}
			if (command === "list_provider_models") {
				return { providerId: "ollama", models: [] };
			}
			return {};
		});

		await act(async () => {
			root.render(
				<SettingsView
					onExportDiagnostics={vi.fn()}
					onNavigateSection={vi.fn()}
					section="Providers"
				/>,
			);
		});
		await vi.waitFor(() => {
			expect(container.textContent).toContain("Not configured");
			expect(invoke).toHaveBeenCalledWith("list_provider_models", {
				provider: "ollama",
			});
			expect(
				container.querySelector<HTMLButtonElement>(
					'button[aria-label="Refresh models"]',
				)?.disabled,
			).toBe(false);
		});

		const connectButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Connect",
		);
		expect(connectButton).toBeDefined();
		await act(async () => connectButton?.click());
		await vi.waitFor(() => {
			expect(invoke).toHaveBeenCalledWith(
				"save_provider_settings",
				expect.objectContaining({ provider: "ollama", enabled: true }),
			);
			expect(resolveSavedCatalog).toBeDefined();
		});

		// The save's authoritative response must survive the shared cache
		// invalidation and update the current screen without navigating away.
		await act(async () => resolveSavedCatalog?.(catalog(true)));
		await vi.waitFor(() => {
			expect(container.textContent).toContain("1 configured · 1 available");
			expect(container.textContent).not.toContain("Not configured");
			expect(
				Array.from(container.querySelectorAll("button")).some(
					(button) => button.textContent?.trim() === "Disconnect",
				),
			).toBe(true);
		});
	});

	it("keeps a catalog reload active when an earlier model request completes", async () => {
		let catalogCalls = 0;
		let resolveFreshCatalog:
			| ((catalog: ProviderCatalogResponse) => void)
			| undefined;
		let resolveEarlierModels:
			| ((response: ProviderModelsResponse) => void)
			| undefined;
		const catalog = (configured: boolean): ProviderCatalogResponse => ({
			providers: [
				{
					id: "ollama",
					name: "Ollama",
					models: null,
					color: "",
					letter: "O",
					enabled: configured,
					configured,
				},
			],
			settingsPath: "/tmp/providers.json",
		});

		invoke.mockImplementation(async (command: string) => {
			if (command === "list_provider_catalog") {
				catalogCalls += 1;
				if (catalogCalls === 1) return catalog(true);
				return new Promise<ProviderCatalogResponse>((resolve) => {
					resolveFreshCatalog = resolve;
				});
			}
			if (command === "list_provider_models") {
				return new Promise<ProviderModelsResponse>((resolve) => {
					resolveEarlierModels = resolve;
				});
			}
			return {};
		});

		await act(async () => {
			root.render(
				<SettingsView
					onExportDiagnostics={vi.fn()}
					onNavigateSection={vi.fn()}
					section="Providers"
				/>,
			);
		});
		await vi.waitFor(() => {
			expect(container.textContent).toContain("1 configured · 1 available");
			expect(resolveEarlierModels).toBeDefined();
		});

		// Another settings section invalidates connection state while the
		// first provider's model request is still outstanding.
		await act(async () => {
			root.render(
				<SettingsView
					onExportDiagnostics={vi.fn()}
					onNavigateSection={vi.fn()}
					section="General"
				/>,
			);
			invalidateProviderCatalogCache();
		});
		await act(async () => {
			root.render(
				<SettingsView
					onExportDiagnostics={vi.fn()}
					onNavigateSection={vi.fn()}
					section="Providers"
				/>,
			);
		});
		await vi.waitFor(() => {
			expect(catalogCalls).toBe(2);
			expect(resolveFreshCatalog).toBeDefined();
			expect(container.textContent).toContain("Loading providers...");
		});

		await act(async () => {
			resolveEarlierModels?.({ providerId: "ollama", models: [] });
		});
		await act(async () => resolveFreshCatalog?.(catalog(false)));

		await vi.waitFor(() => {
			expect(container.textContent).not.toContain("Loading providers...");
			expect(container.textContent).toContain("Not configured");
			expect(container.textContent).not.toContain("1 configured · 1 available");
		});
		expect(catalogCalls).toBe(2);
	});

	it("reloads provider connection state and ignores an older response", async () => {
		let catalogCalls = 0;
		let modelLoads = 0;
		let resolveStaleCatalog:
			| ((catalog: ProviderCatalogResponse) => void)
			| undefined;

		const catalog = (configured: boolean): ProviderCatalogResponse => ({
			providers: [
				{
					id: "cline",
					name: "Cline Usage-Billing",
					models: null,
					color: "",
					letter: "C",
					enabled: true,
					configured,
				},
				{
					id: "cline-pass",
					name: "ClinePass",
					models: null,
					color: "",
					letter: "C",
					enabled: true,
					configured,
				},
			],
			settingsPath: "/tmp/providers.json",
		});

		invoke.mockImplementation(async (command: string) => {
			if (command === "list_provider_catalog") {
				catalogCalls += 1;
				if (catalogCalls === 1) {
					return catalog(true);
				}
				if (catalogCalls === 2) {
					return new Promise<ProviderCatalogResponse>((resolve) => {
						resolveStaleCatalog = resolve;
					});
				}
				return catalog(false);
			}
			if (command === "list_provider_models") {
				modelLoads += 1;
				return { models: [] };
			}
			return {};
		});

		await act(async () => {
			root.render(
				<SettingsView
					onExportDiagnostics={vi.fn()}
					onNavigateSection={vi.fn()}
					section="Providers"
				/>,
			);
		});

		await vi.waitFor(() => {
			expect(catalogCalls).toBe(1);
			expect(container.textContent).toContain("Configured");
			expect(container.textContent).toContain("ClinePass");
			expect(container.textContent).toContain("2 configured · 2 available");
		});
		await vi.waitFor(() => expect(modelLoads).toBeGreaterThan(0));

		// Leave the Providers section so the shared invalidation can clear the
		// SettingsView cache without triggering a second request immediately.
		await act(async () => {
			root.render(
				<SettingsView
					onExportDiagnostics={vi.fn()}
					onNavigateSection={vi.fn()}
					section="General"
				/>,
			);
			invalidateProviderCatalogCache();
		});

		await act(async () => {
			root.render(
				<SettingsView
					onExportDiagnostics={vi.fn()}
					onNavigateSection={vi.fn()}
					section="Providers"
				/>,
			);
		});
		await vi.waitFor(() => expect(catalogCalls).toBe(2));

		// Invalidate the in-flight request, then navigate away and back so the
		// next load gets the authoritative signed-out snapshot.
		await act(async () => {
			invalidateProviderCatalogCache();
		});
		await act(async () => {
			root.render(
				<SettingsView
					onExportDiagnostics={vi.fn()}
					onNavigateSection={vi.fn()}
					section="General"
				/>,
			);
		});
		await act(async () => {
			root.render(
				<SettingsView
					onExportDiagnostics={vi.fn()}
					onNavigateSection={vi.fn()}
					section="Providers"
				/>,
			);
		});

		await vi.waitFor(() => {
			expect(catalogCalls).toBe(3);
			expect(container.textContent).toContain("Not configured");
		});

		await act(async () => {
			resolveStaleCatalog?.(catalog(true));
		});

		expect(container.textContent).toContain("Not configured");
		expect(container.textContent).toContain("ClinePass");
		expect(container.textContent).not.toContain("2 configured · 2 available");
		expect(container.textContent).not.toContain("1 configured · 1 available");
	});
});
