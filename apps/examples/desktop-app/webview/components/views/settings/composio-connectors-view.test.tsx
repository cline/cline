// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	catalog: vi.fn(),
	connect: vi.fn(),
	disconnect: vi.fn(),
	cancel: vi.fn(),
}));
vi.mock("@/lib/composio", () => ({
	fetchComposioToolkitCatalog: mocks.catalog,
}));
vi.mock("@/lib/use-composio-connections", () => ({
	useComposioConnections: () => ({
		configured: true,
		status: { integrations: [] },
		statusBySlug: new Map([
			[
				"gmail",
				{
					toolkit: "gmail",
					status: "connected",
					toolNames: ["GMAIL_SEND_EMAIL"],
				},
			],
		]),
		connect: mocks.connect,
		disconnect: mocks.disconnect,
		cancelConnect: mocks.cancel,
	}),
}));

import { ComposioConnectorsView } from "./composio-connectors-view";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.clearAllMocks();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});
function button(text: string) {
	return [...document.querySelectorAll("button")].find(
		(entry) => entry.textContent?.trim() === text,
	);
}
async function render() {
	await act(async () => root.render(<ComposioConnectorsView />));
}

describe("Customize connector catalog", () => {
	it("shows the grid, installs apps, and manages an existing connection in its dialog", async () => {
		mocks.catalog.mockResolvedValue({
			configured: true,
			toolkits: [
				{ slug: "gmail", name: "Gmail", description: "Email" },
				{ slug: "github", name: "GitHub", description: "Code" },
				{
					slug: "googlecalendar",
					name: "Google Calendar",
					description: "Events",
				},
			],
		});
		await render();
		expect(container.textContent).toContain("GitHub");
		expect(container.textContent).toContain("Google Calendar");
		expect(container.textContent).not.toContain("Marketplace");
		await act(async () => button("Install")?.click());
		expect(mocks.connect).toHaveBeenCalledWith("github");
		await act(async () => button("View")?.click());
		expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
			"GMAIL_SEND_EMAIL",
		);
		await act(async () => button("Uninstall")?.click());
		expect(mocks.disconnect).toHaveBeenCalledWith("gmail");
	});

	it("searches beyond the initial 24 apps", async () => {
		mocks.catalog.mockResolvedValue({
			configured: true,
			toolkits: Array.from({ length: 25 }, (_, i) => ({
				slug: `app_${i}`,
				name: `App ${i}`,
				description: "An app",
			})),
		});
		await render();
		expect(container.textContent).toContain("search to find 1 more");
		expect(container.textContent).not.toContain("App 24");
		const input = container.querySelector(
			'input[aria-label="Search connectors"]',
		) as HTMLInputElement;
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set?.call(input, "App 24");
			input.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(container.textContent).toContain("App 24");
		expect(container.textContent).not.toContain("App 23");
	});

	it("shows catalog errors and retries in Customize", async () => {
		mocks.catalog
			.mockRejectedValueOnce(new Error("Service unavailable"))
			.mockResolvedValueOnce({
				configured: true,
				toolkits: [{ slug: "gmail", name: "Gmail" }],
			});
		await render();
		expect(container.querySelector('[role="alert"]')?.textContent).toContain(
			"Service unavailable",
		);
		await act(async () => button("Retry")?.click());
		expect(container.textContent).toContain("Gmail");
		expect(container.querySelector('[role="alert"]')).toBeNull();
	});
});
