// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpServersContent } from "./mcp-view";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({ desktopClient: { invoke } }));
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
	it.each([
		" foo ",
		"",
	])("preserves stored key %j when renaming from Settings", async (previousName) => {
		const catalog = {
			settingsPath: "/hub/settings.json",
			hasSettingsFile: true,
			servers: [
				{
					name: previousName,
					transportType: "stdio",
					command: "node",
					disabled: true,
				},
			],
		};
		invoke.mockResolvedValue(catalog);
		await act(async () => root.render(<McpServersContent chrome="embedded" />));
		await act(async () => vi.advanceTimersByTimeAsync(0));
		const edit = Array.from(container.querySelectorAll("button")).find(
			(button) => button.getAttribute("aria-label") === `Edit ${previousName}`,
		);
		expect(edit).toBeDefined();
		await act(async () => edit?.click());
		const input = document.querySelector<HTMLInputElement>("#mcp-name");
		expect(input).not.toBeNull();
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set?.call(input, "renamed");
			input?.dispatchEvent(new Event("input", { bubbles: true }));
		});
		const save = Array.from(document.querySelectorAll("button")).find(
			(button) => button.textContent === "Save changes",
		);
		expect(save).toBeDefined();
		await act(async () => save?.click());
		expect(invoke).toHaveBeenCalledWith(
			"upsert_mcp_server",
			{ input: expect.objectContaining({ name: "renamed", previousName }) },
			{ timeoutMs: null },
		);
	});

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
			if (command === "list_mcp_servers") return catalog;
			if (command === "set_mcp_server_disabled")
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
		expect(invoke).toHaveBeenCalledWith(
			"set_mcp_server_disabled",
			{ name: "remote", disabled: true },
			{ timeoutMs: null },
		);
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
