// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	GITHUB_MCP_MARKETPLACE_ENTRY_KEY,
	GITHUB_MCP_SERVER_URL,
} from "@/lib/github-mcp";
import { McpServersContent } from "./mcp-view";

type CapturedMarketplaceProps = {
	excludedEntryKeys?: readonly string[];
	featuredContent?: ReactNode;
	installedItems?: Array<{ key: string; render: () => ReactNode }>;
};

const { clipboardWriteMock, invokeMock, marketplaceProps } = vi.hoisted(() => ({
	clipboardWriteMock: vi.fn(),
	invokeMock: vi.fn(),
	marketplaceProps: {} as CapturedMarketplaceProps,
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: invokeMock },
}));

vi.mock("../marketplace-view", () => ({
	MarketplaceEntrySetupDetails: () => null,
	MarketplaceView: (props: CapturedMarketplaceProps) => {
		marketplaceProps.excludedEntryKeys = props.excludedEntryKeys;
		marketplaceProps.featuredContent = props.featuredContent;
		marketplaceProps.installedItems = props.installedItems;
		return (
			<div data-testid="marketplace">
				<div data-testid="marketplace-search" />
				{props.featuredContent}
				{props.installedItems?.map((item) => (
					<div key={item.key}>{item.render()}</div>
				))}
			</div>
		);
	},
}));

function mcpResponse(servers: unknown[] = []) {
	return {
		settingsPath: "/tmp/cline_mcp_settings.json",
		hasSettingsFile: true,
		servers,
	};
}

function githubServer(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		name: "github",
		transportType: "streamableHttp",
		disabled: true,
		url: GITHUB_MCP_SERVER_URL,
		oauthStatus: {
			supported: true,
			configured: false,
			authorizationRequired: true,
		},
		...overrides,
	};
}

class ResizeObserverStub {
	disconnect() {}
	observe() {}
	unobserve() {}
}

describe("MCP settings pinned GitHub OAuth", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		Object.assign(globalThis, {
			IS_REACT_ACT_ENVIRONMENT: true,
			ResizeObserver: ResizeObserverStub,
		});
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: clipboardWriteMock },
		});
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		delete marketplaceProps.excludedEntryKeys;
		delete marketplaceProps.featuredContent;
		delete marketplaceProps.installedItems;
		clipboardWriteMock.mockReset().mockResolvedValue(undefined);
		invokeMock.mockReset().mockImplementation(async (command: string) => {
			if (command === "list_mcp_servers") {
				return mcpResponse();
			}
			throw new Error(`Unexpected command: ${command}`);
		});
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		vi.restoreAllMocks();
	});

	it("renders GitHub below search and makes the settings source badge copyable", async () => {
		await act(async () => {
			root.render(<McpServersContent />);
		});

		await vi.waitFor(() => {
			expect(container.textContent).toContain("GitHub MCP");
			expect(container.textContent).toContain("Install with GitHub");
		});
		expect(container.textContent).toContain(GITHUB_MCP_SERVER_URL);
		expect(marketplaceProps.excludedEntryKeys).toEqual([
			GITHUB_MCP_MARKETPLACE_ENTRY_KEY,
		]);
		expect(container.textContent).not.toContain("cline config mcp");
		expect(container.textContent).not.toContain("MCP settings path:");

		const heading = container.querySelector("#github-mcp-heading");
		const search = container.querySelector(
			'[data-testid="marketplace-search"]',
		);
		if (!heading || !search) {
			throw new Error("Expected both GitHub and marketplace search sections");
		}
		expect(
			search.compareDocumentPosition(heading) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).not.toBe(0);

		const sourceBadge = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "From settings file",
		);
		if (!sourceBadge) {
			throw new Error("Expected the settings source badge");
		}
		await act(async () => sourceBadge.focus());
		await vi.waitFor(() => {
			const tooltip = document.body.querySelector('[role="tooltip"]');
			expect(tooltip?.textContent).toContain("/tmp/cline_mcp_settings.json");
		});
		await act(async () => sourceBadge.click());
		expect(clipboardWriteMock).toHaveBeenCalledWith(
			"/tmp/cline_mcp_settings.json",
		);
		expect(sourceBadge.textContent).toBe("Path copied");
	});

	it("installs the official endpoint disabled, then starts GitHub OAuth", async () => {
		const callOrder: string[] = [];
		invokeMock.mockImplementation(async (command: string) => {
			callOrder.push(command);
			if (command === "list_mcp_servers") {
				return mcpResponse();
			}
			if (command === "upsert_mcp_server") {
				return mcpResponse([githubServer()]);
			}
			if (command === "authorize_mcp_server_oauth") {
				return mcpResponse([
					githubServer({
						disabled: false,
						oauthStatus: {
							supported: true,
							configured: true,
							authorizationRequired: false,
						},
					}),
				]);
			}
			throw new Error(`Unexpected command: ${command}`);
		});

		await act(async () => {
			root.render(<McpServersContent />);
		});
		const installButton = await vi.waitFor(() => {
			const button = Array.from(container.querySelectorAll("button")).find(
				(candidate) => candidate.textContent?.trim() === "Install with GitHub",
			);
			expect(button).toBeDefined();
			return button as HTMLButtonElement;
		});

		await act(async () => {
			installButton.click();
		});

		await vi.waitFor(() => {
			expect(container.textContent).toContain("OAuth connected");
		});
		expect(invokeMock).toHaveBeenCalledWith("upsert_mcp_server", {
			input: {
				name: "github",
				transportType: "streamableHttp",
				url: GITHUB_MCP_SERVER_URL,
				disabled: true,
			},
		});
		expect(invokeMock).toHaveBeenCalledWith(
			"authorize_mcp_server_oauth",
			{ name: "github" },
			{ timeoutMs: null },
		);
		expect(callOrder).toEqual([
			"list_mcp_servers",
			"upsert_mcp_server",
			"authorize_mcp_server_oauth",
		]);
	});

	it("pins an installed official GitHub server instead of duplicating it", async () => {
		invokeMock.mockImplementation(async (command: string) => {
			if (command === "list_mcp_servers") {
				return mcpResponse([
					githubServer({
						disabled: false,
						oauthStatus: {
							supported: true,
							configured: true,
							authorizationRequired: false,
						},
					}),
				]);
			}
			throw new Error(`Unexpected command: ${command}`);
		});

		await act(async () => {
			root.render(<McpServersContent />);
		});

		await vi.waitFor(() => {
			expect(container.textContent).toContain("OAuth connected");
		});
		const connectedBadge = container.querySelector(
			'[data-oauth-status="connected"]',
		);
		const githubHeader = connectedBadge?.closest(
			'[data-mcp-server-header="github"]',
		);
		expect(connectedBadge?.textContent).toBe("OAuth connected");
		expect(githubHeader).not.toBeNull();
		expect(
			githubHeader?.parentElement?.querySelectorAll(
				'[data-oauth-status="connected"]',
			),
		).toHaveLength(1);
		expect(marketplaceProps.installedItems).toEqual([]);
		expect(
			Array.from(container.querySelectorAll("h3")).filter(
				(heading) => heading.textContent === "GitHub",
			),
		).toHaveLength(1);
	});

	it("keeps an unauthenticated official server off until OAuth succeeds", async () => {
		invokeMock.mockImplementation(async (command: string) => {
			if (command === "list_mcp_servers") {
				return mcpResponse([githubServer()]);
			}
			throw new Error(`Unexpected command: ${command}`);
		});

		await act(async () => {
			root.render(<McpServersContent />);
		});

		const enableSwitch = await vi.waitFor(() => {
			expect(container.textContent).toContain("OAuth required");
			const element = container.querySelector(
				'[aria-label="Enable github"]',
			) as HTMLButtonElement | null;
			expect(element).not.toBeNull();
			return element as HTMLButtonElement;
		});
		expect(enableSwitch.disabled).toBe(true);
	});

	it("compacts an OAuth error into header controls and a tooltip badge", async () => {
		const oauthError =
			'MCP server "linear" requires OAuth authorization. Run authorizeMcpServerOAuth for this server.';
		invokeMock.mockImplementation(async (command: string) => {
			if (command === "list_mcp_servers") {
				return mcpResponse([
					{
						name: "linear",
						transportType: "streamableHttp",
						disabled: true,
						url: "https://mcp.linear.app/mcp",
						oauthStatus: {
							supported: true,
							configured: false,
							authorizationRequired: true,
							lastError: oauthError,
						},
					},
				]);
			}
			throw new Error(`Unexpected command: ${command}`);
		});

		await act(async () => {
			root.render(<McpServersContent />);
		});

		const badge = await vi.waitFor(() => {
			const element = container.querySelector(
				'[data-oauth-status="required"]',
			) as HTMLElement | null;
			expect(element?.textContent).toBe("OAuth required");
			return element as HTMLElement;
		});
		expect(badge.className).toContain("text-destructive");
		expect(badge.getAttribute("title")).toBeNull();
		expect(container.textContent).not.toContain(oauthError);

		await act(async () => badge.focus());
		await vi.waitFor(() => {
			const tooltip = document.body.querySelector('[role="tooltip"]');
			expect(tooltip?.textContent).toContain(oauthError);
		});

		const header = badge.closest('[data-mcp-server-header="linear"]');
		const enableSwitch = header?.querySelector('[aria-label="Enable linear"]');
		const name = header?.querySelector("h3");
		const connectButton = header?.querySelector(
			'[aria-label="Connect linear with OAuth"]',
		);
		if (!header || !enableSwitch || !name || !connectButton) {
			throw new Error("Expected compact OAuth controls in the server header");
		}
		expect(
			enableSwitch.compareDocumentPosition(name) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).not.toBe(0);
		expect(header.lastElementChild).toBe(connectButton);
		expect(header.parentElement?.querySelector('[role="alert"]')).toBeNull();
	});

	it("does not overwrite a different server named github", async () => {
		invokeMock.mockImplementation(async (command: string) => {
			if (command === "list_mcp_servers") {
				return mcpResponse([
					{
						name: "github",
						transportType: "stdio",
						disabled: false,
						command: "custom-github-server",
					},
				]);
			}
			throw new Error(`Unexpected command: ${command}`);
		});

		await act(async () => {
			root.render(<McpServersContent />);
		});

		const installButton = await vi.waitFor(() => {
			const button = Array.from(container.querySelectorAll("button")).find(
				(candidate) => candidate.textContent?.trim() === "Install with GitHub",
			);
			expect(button).toBeDefined();
			return button as HTMLButtonElement;
		});
		expect(installButton.disabled).toBe(true);
		expect(container.textContent).toContain(
			"A different server already uses the name",
		);
	});
});
