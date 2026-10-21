// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	APP_FONT_SIZE_STORAGE_KEY,
	applyAppZoomAction,
} from "@/lib/app-font-size";
import { SettingsView } from "./settings-view";

const { invoke, openExternalUrl, useAccount } = vi.hoisted(() => ({
	invoke: vi.fn(),
	openExternalUrl: vi.fn(),
	useAccount: vi.fn(),
}));
vi.mock("@/contexts/account-context", () => ({ useAccount }));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke },
	isTauriAvailable: vi.fn(() => false),
	openExternalUrl,
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
	openExternalUrl.mockReset();
	useAccount.mockReturnValue({ privacySettingsUrl: undefined });
	invoke.mockImplementation(async (command: string) => {
		if (command === "get_hub_status") {
			return { url: "ws://127.0.0.1:1234", clients: [], events: [] };
		}
		return { telemetryOptOut: false, autoUpdateEnabled: true };
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

describe("SettingsView privacy settings link", () => {
	async function renderGeneralSettingsWithPrivacyLink(
		privacySettingsUrl?: string,
	) {
		useAccount.mockReturnValue({ privacySettingsUrl });
		await act(async () => {
			root.render(
				<SettingsView
					onExportDiagnostics={vi.fn()}
					onNavigateSection={vi.fn()}
					section="General"
				/>,
			);
		});
	}

	const privacySettingsLink = () =>
		Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "privacy settings",
		);

	it("hides the sentence when there is no privacy settings link", async () => {
		await renderGeneralSettingsWithPrivacyLink(undefined);

		expect(container.textContent).toContain("Telemetry");
		expect(container.textContent).not.toContain("Cline Bench");
		expect(privacySettingsLink()).toBeUndefined();
	});

	it("opens the privacy settings link from the account context", async () => {
		await renderGeneralSettingsWithPrivacyLink(
			"https://staging-app.cline.bot/dashboard/account?tab=privacy&client=desktop",
		);

		await act(async () => privacySettingsLink()?.click());

		expect(openExternalUrl).toHaveBeenCalledWith(
			"https://staging-app.cline.bot/dashboard/account?tab=privacy&client=desktop",
		);
	});
});
