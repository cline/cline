// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type FactoryConnections,
	FactorySettingsUnavailable,
	type FactoryStorage,
} from "@/lib/factory-settings-client";
import { click, deadRows, renderSettingsPage } from "../test-utils";
import { settingsPage } from "./this-computer";

vi.mock("@/components/ui/select", async () =>
	(await import("../test-utils")).nativeSelectModule(),
);

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const storage: FactoryStorage = {
	dataDir: "/Users/me/.cline/data/db/factory",
	worktreesDir: "/Users/me/.cline/data/db/factory/factory-worktrees",
	artifactsDir: "/Users/me/.cline/data/db/factory/artifacts",
	logsDir: "/Users/me/.cline/data/db/factory/logs",
	worktrees: {
		count: 14,
		bytes: 3.2 * GB,
		finishedCount: 6,
		finishedBytes: 1.4 * GB,
		unknownCount: 0,
	},
	artifactsBytes: 180 * MB,
	logsBytes: 32 * MB,
	approximate: false,
};
const connections = (
	hub: Partial<FactoryConnections["hub"]> = {},
): FactoryConnections => ({
	gh: { installed: true, hosts: [] },
	linear: { configured: false },
	hub: {
		status: "connected",
		url: "ws://127.0.0.1:25463",
		appVersion: "0.14.2",
		...hub,
	},
});
const base = {
	getStorage: async () => storage,
	getConnections: async () => connections(),
	listProviders: async () => ({ providers: [] }),
	listMcpServers: async () => ({ servers: [] }),
};

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
	writeText = vi.fn(async () => undefined);
	Object.defineProperty(navigator, "clipboard", {
		value: { writeText },
		configurable: true,
	});
});
afterEach(() => {
	document.body.innerHTML = "";
});

describe("This computer: working copies", () => {
	it("says the working copies are loading while they load", async () => {
		const page = await renderSettingsPage(settingsPage, {
			client: { ...base, getStorage: () => new Promise<never>(() => {}) },
		});
		expect(page.container.querySelector("output")?.textContent).toBe(
			"Loading working copies…",
		);
		await page.unmount();
	});

	it("shows the numbers and removes finished copies only after a confirmation that states them", async () => {
		const after: FactoryStorage = {
			...storage,
			worktrees: {
				...storage.worktrees,
				count: 8,
				bytes: 1.8 * GB,
				finishedCount: 0,
				finishedBytes: 0,
			},
		};
		const page = await renderSettingsPage(settingsPage, {
			client: {
				...base,
				cleanStorage: async () => ({
					removed: 6,
					bytes: 1.4 * GB,
					skipped: [],
					storage: after,
				}),
			},
		});
		expect(page.row("diskUse")?.textContent).toContain(
			"14 working copies, 3.2 GB. 6 belong to delivered or archived cards.",
		);
		expect(page.row("evidence")?.textContent).toContain("212 MB.");
		expect(page.row("worktreesDir")?.textContent).toContain(
			"~/.cline/data/db/factory/factory-worktrees",
		);
		expect(page.buttons("Remove finished copies…")[0]?.className).toContain(
			"text-error-text",
		);
		await click(page.buttons("Remove finished copies…")[0]);
		expect(page.shell.client.cleanStorage).not.toHaveBeenCalled();
		const dialog = document.querySelector("[data-settings-confirm]");
		expect(dialog?.textContent).toContain("Remove finished copies?");
		expect(dialog?.textContent).toContain(
			"Removes 6 working copies (1.4 GB). Cards, their PRs and their evidence are kept.",
		);
		await click(page.buttons("Remove copies")[0]);
		expect(page.shell.client.cleanStorage).toHaveBeenCalledTimes(1);
		expect(page.shell.client.cleanStorage).toHaveBeenCalledWith();
		expect(page.shell.saved).toHaveBeenCalledTimes(1);
		expect(page.row("diskUse")?.textContent).toContain(
			"Removed 6 working copies and freed 1.4 GB.",
		);
		expect(page.row("diskUse")?.textContent).toContain(
			"8 working copies, 1.8 GB. 0 belong",
		);
		expect(document.querySelector("[data-settings-confirm]")).toBeNull();
		await page.unmount();
	});

	it("shows a removal the Hub is still doing as in progress, not failed, and blocks a second one", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
		const getStorage = vi
			.fn<() => Promise<FactoryStorage>>()
			.mockResolvedValueOnce(storage)
			.mockResolvedValueOnce({ ...storage, cleaning: true })
			.mockResolvedValue({
				...storage,
				worktrees: { ...storage.worktrees, finishedCount: 0 },
			});
		const page = await renderSettingsPage(settingsPage, {
			client: {
				...base,
				getStorage,
				cleanStorage: async () => ({
					removed: 1,
					bytes: MB,
					skipped: [],
					storage: { ...storage, cleaning: true },
					running: true,
				}),
			},
		});
		await click(page.buttons("Remove finished copies…")[0]);
		await click(page.buttons("Remove copies")[0]);
		const row = () => page.row("diskUse");
		expect(row()?.textContent).toContain("Removing finished copies…");
		expect(row()?.querySelector("[role=alert]")).toBeNull();
		expect(page.buttons("Remove finished copies…")[0]?.disabled).toBe(true);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3_000);
		});
		expect(row()?.textContent).toContain("Removing finished copies…");
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3_000);
		});
		expect(row()?.textContent).not.toContain("Removing finished copies…");
		expect(getStorage).toHaveBeenCalledTimes(3);
		vi.useRealTimers();
		await page.unmount();
	});

	it("has no Finder buttons; Copy puts the full path on the clipboard", async () => {
		const page = await renderSettingsPage(settingsPage, { client: base });
		expect(page.text()).not.toContain("Show in Finder");
		expect(
			[
				...page.buttons("Copy location path"),
				...page.buttons("Copy evidence path"),
			].map((button) => button.textContent),
		).toEqual(["Copy path", "Copy path"]);
		await click(page.buttons("Copy location path")[0]);
		expect(writeText).toHaveBeenCalledWith(storage.worktreesDir);
		expect(page.row("worktreesDir")?.textContent).toContain("Copied");
		await click(page.buttons("Copy evidence path")[0]);
		expect(writeText).toHaveBeenLastCalledWith(storage.artifactsDir);
		expect(deadRows(page.container)).toEqual([]);
		await page.unmount();
	});

	it("degrades to one line when the storage command is unavailable", async () => {
		const page = await renderSettingsPage(settingsPage, {
			client: {
				...base,
				getStorage: async () => {
					throw new FactorySettingsUnavailable("factory_get_storage", "hub");
				},
			},
		});
		expect(page.row("diskUse")).toBeNull();
		expect(
			page.container.querySelector('[data-settings-unavailable="hub"]')
				?.textContent,
		).toBe("Working copies: Update Cline to see them.");
		expect(deadRows(page.container)).toEqual([]);
		await page.unmount();
	});
});

describe("This computer: Hub", () => {
	it("shows a connected Hub's address and version with no update or restart button", async () => {
		const page = await renderSettingsPage(settingsPage, { client: base });
		const hub = page.row("hub")?.textContent ?? "";
		expect(hub).toContain("Connected");
		const pill = [...(page.row("hub")?.querySelectorAll("span") ?? [])].find(
			(span) => span.textContent === "Connected",
		);
		expect(pill?.closest("button")).toBeNull();
		expect(pill?.className).toContain("rounded-full");
		expect(pill?.className).toContain("border-transparent");
		expect(hub).toContain(
			"127.0.0.1:25463 · same version as the app (0.14.2).",
		);
		expect(page.buttons(/Update|Restart/)).toEqual([]);
		expect(deadRows(page.container)).toEqual([]);
		await page.unmount();
	});

	it("updates an outdated Hub only after the person confirms, then relaunches", async () => {
		const page = await renderSettingsPage(settingsPage, {
			client: {
				...base,
				getConnections: async () =>
					connections({
						mismatch: { reason: "outdated_hub", hubCoreVersion: "0.13.9" },
					}),
				upgradeHub: async () => ({ outcome: "upgraded" }),
				relaunchApp: async () => undefined,
			},
		});
		expect(page.row("hub")?.textContent).toContain("Update needed");
		await click(page.buttons("Update Hub…")[0]);
		expect(page.shell.client.upgradeHub).not.toHaveBeenCalled();
		await click(page.buttons("Update and restart")[0]);
		expect(page.shell.client.upgradeHub).toHaveBeenCalledTimes(1);
		expect(page.shell.client.relaunchApp).toHaveBeenCalledTimes(1);
		await page.unmount();
	});

	it("sends a newer Hub to the app's update check instead", async () => {
		const page = await renderSettingsPage(settingsPage, {
			client: {
				...base,
				getConnections: async () =>
					connections({ mismatch: { reason: "build_mismatch" } }),
			},
		});
		expect(page.buttons("Update Hub…")).toEqual([]);
		// It opens the app's own settings, not the browser: no outside arrow.
		expect(
			page.buttons("Check for updates")[0]?.querySelector("svg"),
		).toBeNull();
		await click(page.buttons("Check for updates")[0]);
		expect(page.shell.openAppSettings).toHaveBeenCalledWith("About");
		await page.unmount();
	});

	it("shows a disconnected Hub with Retry, which re-reads", async () => {
		const getConnections = vi.fn(async () =>
			connections({ status: "disconnected", error: "connect ECONNREFUSED" }),
		);
		const page = await renderSettingsPage(settingsPage, {
			client: { ...base, getConnections },
		});
		expect(page.row("hub")?.textContent).toContain("Not connected");
		expect(page.row("hub")?.textContent).toContain("connect ECONNREFUSED");
		await click(page.buttons("Retry")[0]);
		expect(getConnections).toHaveBeenLastCalledWith(true);
		await page.unmount();
	});
});

describe("This computer: diagnostics", () => {
	it("exports and says where the report went", async () => {
		const page = await renderSettingsPage(settingsPage, {
			client: {
				...base,
				exportDiagnostics: async () => ({
					path: "/Users/me/.cline/diagnostics/report.zip",
				}),
			},
		});
		await click(page.buttons("Export diagnostics")[0]);
		await act(async () => {});
		expect(page.row("diagnostics")?.textContent).toContain(
			"Saved to ~/.cline/diagnostics/report.zip.",
		);
		await page.unmount();
	});
});
