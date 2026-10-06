// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	APP_FONT_SIZE_STORAGE_KEY,
	applyAppZoomAction,
} from "@/lib/app-font-size";
import { invalidateProviderCatalogCache } from "@/lib/provider-model-catalog";
import type { ProviderCatalogResponse } from "@/lib/provider-schema";
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
	await act(async () => root.unmount());
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

describe("SettingsView cloud sessions rollout", () => {
	it.each([
		{
			caseName: "the rollout explicitly enables it",
			featureFlags: { cloudAgents: false, cloudAgentsAvailable: true },
			visible: true,
		},
		{
			caseName: "feature flags are unavailable",
			featureFlags: new Error("feature flags unavailable"),
			visible: false,
		},
	])("shows the preview setting only when $caseName", async ({
		featureFlags,
		visible,
	}) => {
		invoke.mockImplementation(async (command: string) => {
			if (command === "get_feature_flags") {
				if (featureFlags instanceof Error) throw featureFlags;
				return featureFlags;
			}
			if (command === "get_desktop_settings") {
				return { cloudSessionsEnabled: false };
			}
			return {
				telemetryOptOut: false,
				autoUpdateEnabled: true,
			};
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
		await vi.waitFor(() =>
			expect(
				container.querySelector(
					'[role="switch"][aria-label="Cloud sessions"]',
				) !== null,
			).toBe(visible),
		);
	});
});

describe("SettingsView provider catalog invalidation", () => {
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
