// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpServersContent } from "./mcp-view";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke },
	openExternalUrl: vi.fn(),
}));
vi.mock("./extensions-view", () => ({
	subscribeToExtensionInventoryInvalidation: () => () => {},
}));
vi.mock("../marketplace-view", () => ({
	MarketplaceView: ({
		installedItems,
	}: {
		installedItems: { key: string; render: () => ReactNode }[];
	}) => (
		<>
			{installedItems.map((item) => (
				<div key={item.key}>{item.render()}</div>
			))}
		</>
	),
	MarketplaceEntrySetupDetails: () => null,
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	invoke.mockReset();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
describe("MCP management completion", () => {
	it("waits for a queued toggle beyond the normal deadline and applies its completion", async () => {
		const server = {
			name: "remote",
			transportType: "streamableHttp",
			url: "https://example.test/mcp",
			disabled: false,
		};
		const catalog = {
			settingsPath: "/hub/settings.json",
			hasSettingsFile: true,
			servers: [server],
		};
		let complete!: (value: unknown) => void;
		invoke.mockImplementation(async (command: string) => {
			if (command === "mcp.servers.list") return catalog;
			if (command === "mcp.servers.set_disabled")
				return new Promise((resolve) => {
					complete = resolve;
				});
			throw new Error(`Unexpected command: ${command}`);
		});
		await act(async () => root.render(<McpServersContent chrome="embedded" />));
		await act(async () => vi.advanceTimersByTimeAsync(0));
		const toggle = container.querySelector<HTMLInputElement>(
			'[aria-label="Enable remote"]',
		);
		expect(toggle).not.toBeNull();
		await act(async () => toggle?.click());
		expect(invoke).toHaveBeenCalledWith("mcp.servers.set_disabled", {
			name: "remote",
			disabled: true,
		});
		await act(async () => vi.advanceTimersByTimeAsync(180_000));
		expect(toggle?.disabled).toBe(true);
		expect(container.textContent).not.toContain("Connection failed");
		await act(async () =>
			complete({ ...catalog, servers: [{ ...server, disabled: true }] }),
		);
		expect(toggle?.disabled).toBe(false);
		expect(toggle?.checked).toBe(false);
	});
});

vi.mock("@/lib/hub-client", async () => {
	const { mockHubApis } = await import("@/lib/test-helpers/hub-api");
	return mockHubApis(invoke);
});

it("waits for Hub cancellation cleanup before re-enabling Connect", async () => {
	const catalog = {
		settingsPath: "/hub/settings.json",
		hasSettingsFile: true,
		servers: [
			{
				name: "remote",
				transportType: "streamableHttp",
				url: "https://example.test/mcp",
				disabled: true,
				oauthStatus: { authorizationRequired: true },
			},
		],
	};
	let finish!: (value: unknown) => void;
	invoke.mockImplementation(async (command: string) => {
		if (command === "mcp.servers.list") return catalog;
		if (command === "mcp.oauth.next")
			return new Promise((resolve) => {
				finish = resolve;
			});
		return {};
	});
	await act(async () => root.render(<McpServersContent chrome="embedded" />));
	await act(async () => vi.advanceTimersByTimeAsync(0));
	await act(async () =>
		container
			.querySelector<HTMLButtonElement>(
				'[aria-label="Connect remote with OAuth"]',
			)
			?.click(),
	);
	expect(finish).toBeTypeOf("function");
	await act(async () =>
		container
			.querySelector<HTMLButtonElement>(
				'[aria-label="Cancel OAuth for remote"]',
			)
			?.click(),
	);
	expect(
		container.querySelector('[aria-label="Connect remote with OAuth"]'),
	).toBeNull();
	expect(
		invoke.mock.calls.filter(([command]) => command === "mcp.servers.list"),
	).toHaveLength(1);
	await act(async () =>
		finish({
			urls: [],
			error: { code: "mcp_oauth_cancelled", message: "cancelled" },
		}),
	);
	expect(
		container.querySelector('[aria-label="Connect remote with OAuth"]'),
	).not.toBeNull();
});

it("sends disconnected cancellation when the MCP view unmounts", async () => {
	const catalog = {
		settingsPath: "/hub/settings.json",
		hasSettingsFile: true,
		servers: [
			{
				name: "remote",
				transportType: "streamableHttp",
				url: "https://example.test/mcp",
				disabled: false,
				oauthStatus: { authorizationRequired: true },
			},
		],
	};
	let finish!: (value: unknown) => void;
	invoke.mockImplementation(async (command: string) => {
		if (command === "mcp.servers.list") return catalog;
		if (command === "mcp.oauth.next")
			return new Promise((resolve) => {
				finish = resolve;
			});
		return {};
	});
	await act(async () => root.render(<McpServersContent chrome="embedded" />));
	await act(async () => vi.advanceTimersByTimeAsync(0));
	await act(async () =>
		container
			.querySelector<HTMLButtonElement>(
				'[aria-label="Connect remote with OAuth"]',
			)
			?.click(),
	);
	await act(async () => root.render(null));
	expect(invoke).toHaveBeenCalledWith(
		"mcp.oauth.cancel",
		expect.objectContaining({ reason: "disconnected" }),
	);
	await act(async () =>
		finish({
			urls: [],
			error: { code: "mcp_oauth_cancelled", message: "disconnected" },
		}),
	);
});
