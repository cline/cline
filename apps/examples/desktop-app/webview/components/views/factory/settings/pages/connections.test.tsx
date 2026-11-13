// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type FactoryConnections,
	type FactoryProviderCatalog,
	FactorySettingsUnavailable,
} from "@/lib/factory-settings-client";
import { MODEL_SELECTION_STORAGE_KEY } from "@/lib/model-selection";
import {
	click,
	deadRows,
	fakeShell,
	fakeWorkflow,
	mockClient,
	renderSettingsPage,
} from "../test-utils";
import type { SettingsShell } from "../types";
import { settingsPage } from "./connections";

vi.mock("@/components/ui/select", async () =>
	(await import("../test-utils")).nativeSelectModule(),
);

const anthropic = (modelId = "claude-fable-5-2") => ({
	modelSelection: { providerId: "anthropic", modelId },
});
const openai = {
	modelSelection: { providerId: "openai-native", modelId: "gpt-6-astra" },
};
const workflow = fakeWorkflow({
	agents: {
		designer: anthropic(),
		planReviewers: [openai],
		implementers: [anthropic(), openai],
		reviewers: [openai, anthropic()],
		verifier: anthropic("claude-haiku-5"),
	},
} as never);

const signedIn: FactoryConnections = {
	gh: {
		installed: true,
		version: "2.63.0",
		path: "/opt/homebrew/bin/gh",
		hosts: [{ host: "github.com", login: "octo-dev", signedIn: true }],
	},
	linear: { configured: false },
	hub: {
		status: "connected",
		url: "ws://127.0.0.1:25463",
		appVersion: "0.14.2",
	},
};
const signedOut: FactoryConnections = {
	...signedIn,
	gh: {
		installed: true,
		version: "2.63.0",
		hosts: [{ host: "github.com", signedIn: false }],
	},
};
const notInstalled: FactoryConnections = {
	...signedIn,
	gh: { installed: false, hosts: [] },
	linear: { configured: true },
};
const catalog: FactoryProviderCatalog = {
	providers: [
		{ id: "anthropic", name: "Anthropic", enabled: true, configured: true },
		{ id: "openai-native", name: "OpenAI", enabled: false, configured: false },
	],
};
const client = (gh: FactoryConnections, providers = catalog) => ({
	getConnections: vi.fn(async () => gh),
	listProviders: async () => providers,
	listMcpServers: async () => ({
		servers: [
			{ name: "github" },
			{ name: "linear" },
			{ name: "playwright", disabled: true },
		],
	}),
});

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
	localStorage.setItem(
		MODEL_SELECTION_STORAGE_KEY,
		JSON.stringify({ lastProvider: "anthropic", lastModelByProvider: {} }),
	);
	writeText = vi.fn(async () => undefined);
	Object.defineProperty(navigator, "clipboard", {
		value: { writeText },
		configurable: true,
	});
});
afterEach(() => {
	document.body.innerHTML = "";
	localStorage.clear();
});

describe("Connections", () => {
	it("shows each status with a real action when gh is signed in", async () => {
		const page = await renderSettingsPage(settingsPage, {
			client: client(signedIn),
			shell: { workflow },
		});
		const gh = page.row("gh")?.textContent ?? "";
		expect(gh).toContain("Connected");
		expect(gh).toContain("Signed in to github.com as octo-dev · gh 2.63.0.");
		expect(page.row("provider-anthropic")?.textContent).toContain(
			"Scoping agent, Builder 1, Tester, Code reviewer 2, Manager",
		);
		const openaiRow = page.row("provider-openai-native")?.textContent ?? "";
		expect(openaiRow).toContain("Plan checker, Builder 2, Code reviewer 1");
		expect(openaiRow).toContain("Not connected");
		expect(openaiRow).toContain(
			"Work stops at the first of these roles until OpenAI is connected.",
		);
		expect(page.row("linear")?.textContent).toContain("Not set up");
		expect(page.row("mcp")?.textContent).toContain(
			"3 MCP servers set up in the app, 1 turned off.",
		);
		expect(page.text()).not.toMatch(/token|apiKey/i);
		expect(deadRows(page.container)).toEqual([]);

		await click(page.row("provider-anthropic")?.querySelector("button"));
		await click(page.buttons("Connect")[0]);
		await click(page.buttons("Manage providers")[0]);
		expect(page.shell.openAppSettings).toHaveBeenCalledTimes(3);
		expect(page.shell.openAppSettings).toHaveBeenNthCalledWith(1, "Providers");
		expect(page.shell.openAppSettings).toHaveBeenNthCalledWith(2, "Providers");
		await click(page.buttons("Open MCP settings")[0]);
		expect(page.shell.openAppSettings).toHaveBeenLastCalledWith("Customize");
		await page.unmount();
	});

	it("marks only the browser links with an arrow and draws Manage providers as a bordered button", async () => {
		const page = await renderSettingsPage(settingsPage, {
			client: client(signedIn),
			shell: { workflow },
		});
		await click(page.row("linear")?.querySelector("button[aria-expanded]"));
		const withArrow = [...page.container.querySelectorAll("button")]
			.filter((button) => button.querySelector("svg.lucide-arrow-up-right"))
			.map((button) => button.textContent);
		expect(withArrow).toEqual(["Open Linear settings"]);
		expect(page.buttons("Manage providers")[0]?.className.split(" ")).toContain(
			"border",
		);
		await page.unmount();
	});

	it("gives the exact sign-in command to copy when gh is not signed in", async () => {
		const page = await renderSettingsPage(settingsPage, {
			client: client(signedOut),
			shell: { workflow },
		});
		const gh = page.row("gh")?.textContent ?? "";
		expect(gh).toContain("Not signed in");
		expect(gh).toContain("gh auth login");
		await click(page.buttons("Copy command")[0]);
		expect(writeText).toHaveBeenCalledWith("gh auth login");
		expect(deadRows(page.container)).toEqual([]);
		await page.unmount();
	});

	it("links to cli.github.com when gh is not installed, and shows Linear as ready", async () => {
		const page = await renderSettingsPage(settingsPage, {
			client: {
				...client(notInstalled),
				openExternalUrl: async () => ({ opened: true }),
			},
			shell: { workflow },
		});
		expect(page.row("gh")?.textContent).toContain("Not installed");
		await click(page.buttons("Open cli.github.com")[0]);
		expect(page.shell.client.openExternalUrl).toHaveBeenCalledWith(
			"https://cli.github.com",
		);
		expect(page.row("linear")?.textContent).toContain("Ready");
		await page.unmount();
	});

	it("Check again re-reads every status, bypassing the gh cache", async () => {
		const answers = client(signedOut);
		const page = await renderSettingsPage(settingsPage, {
			client: answers,
			shell: { workflow },
		});
		expect(page.shell.client.getConnections).toHaveBeenCalledWith(false);
		vi.mocked(page.shell.client.getConnections).mockImplementation(
			async () => signedIn,
		);
		await click(page.buttons("Check again")[0]);
		expect(page.shell.client.getConnections).toHaveBeenLastCalledWith(true);
		expect(page.shell.client.listProviders).toHaveBeenCalledTimes(2);
		expect(page.row("gh")?.textContent).toContain(
			"Signed in to github.com as octo-dev",
		);
		await page.unmount();
	});

	it("says GitHub and Linear are unavailable on a build without the command and keeps the rest", async () => {
		const page = await renderSettingsPage(settingsPage, {
			client: {
				...client(signedIn),
				getConnections: async () => {
					throw new FactorySettingsUnavailable(
						"factory_get_connections",
						"build",
					);
				},
			},
			shell: { workflow },
		});
		const notes = [
			...page.container.querySelectorAll("[data-settings-unavailable]"),
		].map((note) => note.textContent);
		expect(notes).toEqual([
			"GitHub and Linear: not available in this build.",
			"GitHub and Linear: not available in this build.",
		]);
		expect(page.row("gh")).toBeNull();
		expect(page.row("provider-anthropic")).not.toBeNull();
		expect(deadRows(page.container)).toEqual([]);
		await page.unmount();
	});
});

describe("Connections: nav count", () => {
	async function badge(shell: SettingsShell) {
		const container = document.createElement("div");
		const root = createRoot(container);
		function Probe() {
			return <span>{settingsPage.useBadge?.(shell)}</span>;
		}
		await act(async () => root.render(<Probe />));
		await act(async () => {});
		const count = Number(container.textContent);
		await act(async () => root.unmount());
		return count;
	}

	it("counts gh not signed in and each role provider not connected", async () => {
		expect(
			await badge(
				fakeShell({ workflow, client: mockClient(client(signedOut)) }),
			),
		).toBe(2);
		expect(
			await badge(
				fakeShell({ workflow, client: mockClient(client(signedIn)) }),
			),
		).toBe(1);
		expect(
			await badge(
				fakeShell({
					workflow,
					client: mockClient(
						client(signedIn, {
							providers: catalog.providers?.map((p) => ({
								...p,
								configured: true,
							})),
						}),
					),
				}),
			),
		).toBe(0);
		expect(settingsPage.badgeLabel?.(2)).toBe("2 connections not ready");
	});
});
