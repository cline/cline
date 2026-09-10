// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatMcpConnectionStatus, McpServersContent } from "./mcp-view";

const { fetchMarketplaceCatalog, invoke } = vi.hoisted(() => ({
	fetchMarketplaceCatalog: vi.fn(),
	invoke: vi.fn(),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke },
	openExternalUrl: vi.fn(),
}));

vi.mock("@/lib/marketplace", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/marketplace")>()),
	fetchMarketplaceCatalog,
}));

const EMPTY_CATALOG = {
	version: 1,
	counts: { total: 0, plugins: 0, skills: 0, mcps: 0 },
	tags: [],
	entries: [],
};

const SETTINGS_PATH =
	"/Users/test/.cline/data/settings/cline_mcp_settings.json";

const SERVERS = [
	{
		name: "desktop-commander",
		transportType: "stdio",
		disabled: false,
		command: "npx",
		args: ["-y", "@wonderwhy-er/desktop-commander@latest"],
		timeout: 60,
		connection: { connected: true, toolCount: 27, updatedAt: 1_700_000_000 },
	},
	{
		name: "quiet",
		transportType: "stdio",
		disabled: false,
		command: "sleep",
		args: ["100000"],
		connection: {
			connected: false,
			error:
				'MCP request to "quiet" (initialize) timed out after 5s. Increase the "timeout" field (in seconds) for this server in cline_mcp_settings.json.',
			updatedAt: 1_700_000_000,
		},
	},
	{
		name: "paused",
		transportType: "stdio",
		disabled: true,
		command: "node",
		connection: { connected: true, toolCount: 3, updatedAt: 1_700_000_000 },
	},
	{
		name: "fresh",
		transportType: "stdio",
		disabled: false,
		command: "node",
	},
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	fetchMarketplaceCatalog.mockReset();
	fetchMarketplaceCatalog.mockResolvedValue(EMPTY_CATALOG);
	invoke.mockReset();
	invoke.mockImplementation((command: string) => {
		if (command === "list_mcp_servers") {
			return Promise.resolve({
				settingsPath: SETTINGS_PATH,
				hasSettingsFile: true,
				servers: SERVERS,
			});
		}
		if (command === "list_marketplace_installed_entries") {
			return Promise.resolve({ installedKeys: [] });
		}
		if (command === "upsert_mcp_server") {
			return Promise.resolve({
				settingsPath: SETTINGS_PATH,
				hasSettingsFile: true,
				servers: SERVERS,
			});
		}
		return Promise.reject(new Error(`Unexpected command: ${command}`));
	});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

async function renderView() {
	await act(async () => {
		root.render(
			<McpServersContent chrome="embedded" marketplaceVariant="installed" />,
		);
	});
	await vi.waitFor(() => {
		expect(container.textContent).toContain("desktop-commander");
	});
}

function setInputValue(input: HTMLInputElement, value: string) {
	const nativeSetter = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	)?.set;
	nativeSetter?.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("formatMcpConnectionStatus", () => {
	it("summarizes connected servers with their tool count", () => {
		expect(
			formatMcpConnectionStatus({
				connected: true,
				toolCount: 27,
				updatedAt: 1,
			}),
		).toBe("Connected, 27 tools");
		expect(
			formatMcpConnectionStatus({
				connected: true,
				toolCount: 1,
				updatedAt: 1,
			}),
		).toBe("Connected, 1 tool");
	});

	it("names the failure reason for servers that did not connect", () => {
		expect(
			formatMcpConnectionStatus({
				connected: false,
				error: "spawn /usr/bin/nonexistent-mcp ENOENT",
				updatedAt: 1,
			}),
		).toBe("Failed: spawn /usr/bin/nonexistent-mcp ENOENT");
	});
});

describe("McpServersContent connection status", () => {
	it("shows connected state with tool count and failure reasons per server", async () => {
		await renderView();

		expect(container.textContent).toContain("Connected, 27 tools");
		expect(container.textContent).toContain(
			'Failed: MCP request to "quiet" (initialize) timed out after 5s.',
		);
		expect(container.textContent).toContain("Timeout: 60s");
	});

	it("hides stale status for disabled servers and shows nothing for untried ones", async () => {
		await renderView();

		expect(container.textContent).not.toContain("Connected, 3 tools");
		const statusLines = container.textContent?.match(/Connected, /g) ?? [];
		expect(statusLines).toHaveLength(1);
	});
});

describe("McpServersContent timeout field", () => {
	it("prefills the timeout when editing and persists it on save", async () => {
		await renderView();

		const editButton = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Edit desktop-commander"]',
		);
		expect(editButton).not.toBeNull();
		await act(async () => editButton?.click());

		const timeoutInput = await vi.waitFor(() => {
			const input =
				document.body.querySelector<HTMLInputElement>("input#mcp-timeout");
			expect(input).not.toBeNull();
			return input as HTMLInputElement;
		});
		expect(timeoutInput.value).toBe("60");

		await act(async () => setInputValue(timeoutInput, "45"));
		const saveButton = [...document.body.querySelectorAll("button")].find(
			(button) => button.textContent === "Save changes",
		);
		expect(saveButton).toBeDefined();
		await act(async () => saveButton?.click());

		await vi.waitFor(() => {
			expect(invoke).toHaveBeenCalledWith("upsert_mcp_server", {
				input: expect.objectContaining({
					name: "desktop-commander",
					transportType: "stdio",
					command: "npx",
					timeout: 45,
				}),
			});
		});
	});

	it("rejects a non-positive timeout before saving", async () => {
		await renderView();

		await act(async () =>
			container
				.querySelector<HTMLButtonElement>(
					'button[aria-label="Edit desktop-commander"]',
				)
				?.click(),
		);
		const timeoutInput = await vi.waitFor(() => {
			const input =
				document.body.querySelector<HTMLInputElement>("input#mcp-timeout");
			expect(input).not.toBeNull();
			return input as HTMLInputElement;
		});
		await act(async () => setInputValue(timeoutInput, "0"));
		const saveButton = [...document.body.querySelectorAll("button")].find(
			(button) => button.textContent === "Save changes",
		);
		await act(async () => saveButton?.click());

		await vi.waitFor(() => {
			expect(document.body.textContent).toContain(
				"Timeout must be a positive number of seconds.",
			);
		});
		expect(invoke).not.toHaveBeenCalledWith(
			"upsert_mcp_server",
			expect.anything(),
		);
	});
});
