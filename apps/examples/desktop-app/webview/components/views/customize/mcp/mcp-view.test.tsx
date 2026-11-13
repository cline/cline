// @vitest-environment jsdom

import { act, type ComponentProps, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	commitMcpServersResponse,
	getCachedMcpServers,
	invalidateExtensionInventoryCache,
	type McpServer,
} from "@/lib/extension-inventory";
import type { MarketplaceEntry } from "@/lib/marketplace";
import { clearMarketplaceInstalledEntries } from "@/lib/marketplace-installed";
import { revealActionLabel } from "@/lib/reveal-label";
import { useMcpInventory } from "@/lib/use-mcp-inventory";
import {
	getInstalledMcpServers,
	mcpMarketplaceItem,
} from "../extensions/installed-marketplace-selectors";
import {
	type InstalledMarketplaceModel,
	useInstalledMarketplaceItems,
} from "../marketplace/use-installed-marketplace-items";
import { CustomizationCategoryNavigationProvider } from "../shared/customization-category-section";
import {
	CustomizeRefreshButton,
	CustomizeRefreshProvider,
} from "../shared/customize-refresh";
import { InstalledMcpDetailPage } from "./installed-mcp-detail";
import type { InstalledMcpSelection } from "./mcp-types";
import { McpServersContent } from "./mcp-view";

/** The reveal action is named for the desktop the tests run on. */
const REVEAL = revealActionLabel();

const { invoke, fetchMarketplaceCatalog, openExternalUrl } = vi.hoisted(() => ({
	invoke: vi.fn(),
	fetchMarketplaceCatalog: vi.fn(),
	openExternalUrl: vi.fn(),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke, subscribe: () => () => {} },
	openExternalUrl,
}));
vi.mock("@/lib/marketplace", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/marketplace")>()),
	fetchMarketplaceCatalog,
}));

let container: HTMLDivElement;
let root: Root;

const localServer: McpServer = {
	name: "local-tools",
	transportType: "stdio",
	disabled: false,
	command: "bun",
	args: ["server.ts"],
	env: { SERVICE_TOKEN: "test-secret" },
};
const inventory = (servers = [localServer]) => ({
	settingsPath: "/settings/mcp.json",
	hasSettingsFile: true,
	servers,
});

beforeEach(() => {
	invalidateExtensionInventoryCache();
	clearMarketplaceInstalledEntries();
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	invoke.mockReset();
	fetchMarketplaceCatalog.mockReset();
	openExternalUrl.mockReset();
	fetchMarketplaceCatalog.mockResolvedValue({ entries: [], tags: [] });
	invoke.mockImplementation(async (command: string) => {
		if (command === "list_mcp_servers") return inventory();
		if (command === "list_marketplace_installed_entries")
			return { installedKeys: [] };
		throw new Error(`Unexpected command: ${command}`);
	});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

/** Resolves the servers' catalog matches first, as the Customize page does. */
function McpServers({
	onOpenMcp = () => {},
	onCreateMcp = () => {},
	...props
}: Partial<
	Omit<ComponentProps<typeof McpServersContent>, "marketplaceModel">
>) {
	const { response } = useMcpInventory();
	const { includeBuiltinItems = true, searchQuery, searchResults } = props;
	const installedItems = useMemo(
		() =>
			getInstalledMcpServers(response?.servers ?? [], includeBuiltinItems).map(
				mcpMarketplaceItem,
			),
		[response, includeBuiltinItems],
	);
	const marketplaceModel = useInstalledMarketplaceItems({
		installedItems,
		primitive: "mcp",
		searchQuery,
		searchResults,
	});
	return (
		<McpServersContent
			{...props}
			marketplaceModel={marketplaceModel}
			onOpenMcp={onOpenMcp}
			onCreateMcp={onCreateMcp}
		/>
	);
}

async function renderServers(
	sharedRefresh = false,
	onOpenMcp?: (
		selection: InstalledMcpSelection,
		trigger?: HTMLButtonElement,
	) => void,
	onCreateMcp = vi.fn(),
) {
	await act(async () => {
		root.render(
			<CustomizeRefreshProvider enabled={sharedRefresh}>
				<CustomizeRefreshButton />
				<McpServers onOpenMcp={onOpenMcp} onCreateMcp={onCreateMcp} />
			</CustomizeRefreshProvider>,
		);
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

describe("MCP item cards", () => {
	it("uses the parent's result model without loading another marketplace inventory", async () => {
		const model: InstalledMarketplaceModel = {
			summary: { query: "", count: 1, loading: false, error: false },
			catalog: {
				version: 1,
				counts: { total: 0, mcps: 0, skills: 0, plugins: 0 },
				entries: [],
				tags: [],
			},
			errorMessage: null,
			loading: false,
			tagLabels: new Map(),
			installedStatusReady: true,
			installedError: null,
			actionStates: new Map(),
			uninstall: vi.fn(async () => {}),
			sharedCategory: null,
			catalogResultsReady: true,
			searchCount: 1,
			installedEntries: [],
			localInstalledItems: [
				{
					item: { key: localServer.name, matchValues: [localServer.name] },
					matchedEntries: [],
				},
			],
		};
		await act(async () =>
			root.render(
				<McpServersContent
					marketplaceModel={model}
					onOpenMcp={vi.fn()}
					onCreateMcp={vi.fn()}
				/>,
			),
		);
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		expect(
			container.querySelector('[aria-label="View local-tools details"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[data-slot="section-heading-count"]')
				?.textContent,
		).toBe("1");
		expect(fetchMarketplaceCatalog).not.toHaveBeenCalled();
		expect(invoke.mock.calls.map(([command]) => command)).toEqual([
			"list_mcp_servers",
		]);

		invoke.mockResolvedValueOnce(
			inventory([{ ...localServer, disabled: true }]),
		);
		await act(async () =>
			container
				.querySelector<HTMLInputElement>('[aria-label="Enable local-tools"]')
				?.click(),
		);
		expect(invoke).toHaveBeenCalledWith(
			"set_mcp_server_disabled",
			{
				name: "local-tools",
				disabled: true,
			},
			{ timeoutMs: null },
		);
		expect(
			container.querySelector<HTMLInputElement>(
				'[aria-label="Enable local-tools"]',
			)?.checked,
		).toBe(false);
		expect(fetchMarketplaceCatalog).not.toHaveBeenCalled();
	});

	it("offers Browse and Add from the centered empty state", async () => {
		const onSelectType = vi.fn();
		const onCreateMcp = vi.fn();
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_mcp_servers") return inventory([]);
			if (command === "list_marketplace_installed_entries")
				return { installedKeys: [] };
			throw new Error(`Unexpected command: ${command}`);
		});
		await act(async () =>
			root.render(
				<CustomizationCategoryNavigationProvider
					onSelectCategory={vi.fn()}
					onSelectType={onSelectType}
				>
					<McpServers onCreateMcp={onCreateMcp} />
				</CustomizationCategoryNavigationProvider>,
			),
		);
		const emptyState = container.querySelector('[data-slot="empty-state"]');
		expect(emptyState?.getAttribute("data-align")).toBe("center");
		expect(
			emptyState?.querySelector('[data-slot="empty-state-description"]')
				?.textContent,
		).toBe("No MCP servers found.");
		const buttons = [...(emptyState?.querySelectorAll("button") ?? [])];
		expect(buttons.map((button) => button.textContent)).toEqual([
			"Browse customizations",
			"Add MCP server",
		]);
		await act(async () => buttons[0]?.click());
		expect(onSelectType).toHaveBeenCalledExactlyOnceWith("mcp");
		await act(async () => buttons[1]?.click());
		expect(onCreateMcp).toHaveBeenCalledExactlyOnceWith(buttons[1]);
	});

	it("opens installed server details while keeping card controls independent", async () => {
		const onOpenMcp = vi.fn();
		await renderServers(false, onOpenMcp);
		const trigger = container.querySelector<HTMLButtonElement>(
			'[aria-label="View local-tools details"]',
		);
		expect(trigger).not.toBeNull();
		expect(
			container.querySelector('[aria-label="Edit local-tools"]'),
		).toBeNull();
		expect(
			container.querySelector('[aria-label="Delete local-tools"]'),
		).toBeNull();
		await act(async () => trigger?.click());
		expect(onOpenMcp).toHaveBeenCalledExactlyOnceWith(
			{ server: localServer, entry: undefined },
			trigger,
		);
		invoke.mockResolvedValueOnce(
			inventory([{ ...localServer, disabled: true }]),
		);
		await act(async () =>
			container
				.querySelector<HTMLInputElement>('[aria-label="Enable local-tools"]')
				?.click(),
		);
		expect(invoke).toHaveBeenCalledWith(
			"set_mcp_server_disabled",
			{
				name: "local-tools",
				disabled: true,
			},
			{ timeoutMs: null },
		);
		expect(onOpenMcp).toHaveBeenCalledOnce();
	});
	it("counts installed marketplace fallback servers in its category heading", async () => {
		fetchMarketplaceCatalog.mockResolvedValue({
			entries: [
				{
					id: "fallback-server",
					type: "mcp",
					name: "Fallback server",
					tags: [],
					install: { command: "", args: [] },
				},
			],
			tags: [],
		});
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_mcp_servers") return inventory([]);
			if (command === "list_marketplace_installed_entries")
				return { installedKeys: ["mcp:fallback-server"] };
			throw new Error(`Unexpected command: ${command}`);
		});
		await renderServers();
		expect(
			container.querySelector('[data-slot="section-heading-count"]')
				?.textContent,
		).toBe("1");
		expect(
			container.querySelector('[data-slot="item-card"]')?.textContent,
		).toContain("Fallback server");
	});
	it("omits the category count until local inventory finishes loading", async () => {
		let resolveInventory!: (response: ReturnType<typeof inventory>) => void;
		const pendingInventory = new Promise((resolve) => {
			resolveInventory = resolve;
		});
		invoke.mockImplementation((command: string) =>
			command === "list_mcp_servers"
				? pendingInventory
				: Promise.resolve({ installedKeys: [] }),
		);
		await renderServers();
		expect(
			container.querySelector('[data-slot="section-heading-count"]'),
		).toBeNull();
		await act(async () => resolveInventory(inventory()));
		expect(
			container.querySelector('[data-slot="section-heading-count"]')
				?.textContent,
		).toBe("1");
	});
	it("omits the category count when marketplace inventory is unavailable", async () => {
		fetchMarketplaceCatalog.mockRejectedValue(new Error("Catalog unavailable"));
		await renderServers();
		expect(container.textContent).toContain("Catalog unavailable");
		expect(
			container.querySelector('[data-slot="section-heading-count"]'),
		).toBeNull();
	});
	it.each([
		false,
		true,
	])("uses one counted MCP heading with refresh and creation controls (shared: %s)", async (shared) => {
		await renderServers(shared);
		expect(
			container.querySelector('[data-slot="scroll-area-viewport"]'),
		).toBeNull();
		const heading = container.querySelector('[data-slot="section-heading"]');
		expect(heading?.querySelector("h3")?.textContent).toBe("MCP");
		expect(
			heading?.querySelector('[data-slot="section-heading-count"]')
				?.textContent,
		).toBe("1");
		expect(
			[...container.querySelectorAll("h2, h3")].map((item) => item.textContent),
		).toEqual(["MCP"]);
		expect(
			Boolean(heading?.querySelector('[aria-label="Refresh MCP servers"]')),
		).toBe(!shared);
		expect(
			heading?.querySelector('[data-slot="section-heading-actions"]')
				?.textContent,
		).toContain("Add MCP server");
		expect(container.textContent).not.toContain("MCP settings path");
		invoke.mockClear();
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>(
					shared
						? '[aria-label="Refresh customizations"]'
						: '[aria-label="Refresh MCP servers"]',
				)
				?.click(),
		);
		expect(invoke).toHaveBeenCalledWith("list_mcp_servers");
	});
	it("keeps configuration off cards and disables the toggle while saving", async () => {
		await renderServers();
		const toggle = container.querySelector<HTMLInputElement>(
			'[aria-label="Enable local-tools"]',
		);
		const card = toggle?.closest('[data-slot="item-card"]');
		expect(card?.textContent).not.toContain("Command: bun");
		expect(card?.textContent).not.toContain("Args: server.ts");
		expect(card?.textContent).not.toContain("SERVICE_TOKEN");
		expect(card?.textContent).not.toContain("test-secret");
		let completeSave!: (value: ReturnType<typeof inventory>) => void;
		invoke.mockReturnValueOnce(
			new Promise((resolve) => {
				completeSave = resolve;
			}),
		);
		await act(async () => toggle?.click());
		expect(invoke).toHaveBeenLastCalledWith(
			"set_mcp_server_disabled",
			{
				name: "local-tools",
				disabled: true,
			},
			{ timeoutMs: null },
		);
		expect(toggle?.disabled).toBe(true);
		expect(card?.querySelector('[aria-label="Edit local-tools"]')).toBeNull();
		expect(card?.querySelector('[aria-label="Delete local-tools"]')).toBeNull();
		await act(async () =>
			completeSave(inventory([{ ...localServer, disabled: true }])),
		);
		expect(toggle?.checked).toBe(false);
		expect(toggle?.disabled).toBe(false);
	});

	it("waits for a queued toggle beyond the normal deadline and applies its completion", async () => {
		await renderServers();
		const toggle = container.querySelector<HTMLInputElement>(
			'[aria-label="Enable local-tools"]',
		);
		const card = toggle?.closest('[data-slot="item-card"]');
		let complete!: (value: ReturnType<typeof inventory>) => void;
		invoke.mockReturnValueOnce(
			new Promise((resolve) => {
				complete = resolve;
			}),
		);
		vi.useFakeTimers();
		try {
			await act(async () => toggle?.click());
			expect(invoke).toHaveBeenLastCalledWith(
				"set_mcp_server_disabled",
				{ name: "local-tools", disabled: true },
				{ timeoutMs: null },
			);
			await act(async () => vi.advanceTimersByTimeAsync(180_000));
			expect(toggle?.disabled).toBe(true);
			expect(card?.textContent).not.toContain("Action failed");
			expect(document.querySelector('[role="dialog"]')).toBeNull();
			await act(async () =>
				complete(inventory([{ ...localServer, disabled: true }])),
			);
			expect(toggle?.disabled).toBe(false);
			expect(toggle?.checked).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it("opens failed card actions in a dialog without adding error details to the card", async () => {
		const onOpenMcp = vi.fn();
		await renderServers(false, onOpenMcp);
		invoke.mockRejectedValueOnce(new Error("Could not update this server"));
		await act(async () =>
			container
				.querySelector<HTMLInputElement>('[aria-label="Enable local-tools"]')
				?.click(),
		);
		const card = container.querySelector('[data-slot="item-card"]');
		expect(card?.querySelector("output")?.textContent).toBe("Action failed");
		expect(
			card?.querySelector("output")?.classList.contains("text-error-text"),
		).toBe(true);
		expect(card?.textContent).not.toContain("Could not update");
		expect(
			card?.querySelector('[data-slot="item-card-actions"] button'),
		).toBeNull();
		expect(card?.querySelector('[role="switch"]')).toBeNull();
		const dialog = document.querySelector('[role="dialog"]');
		expect(dialog?.textContent).toContain("Could not update this server");
		expect(dialog?.textContent).toContain("Action failed");
		expect(dialog?.textContent).not.toContain("Connection error");
		const retryToggle = dialog?.querySelector<HTMLInputElement>(
			'[aria-label="Enable local-tools"]',
		);
		expect(retryToggle?.disabled).toBe(false);
		invoke.mockResolvedValueOnce(
			inventory([{ ...localServer, disabled: true }]),
		);
		await act(async () => retryToggle?.click());
		expect(invoke).toHaveBeenCalledWith(
			"set_mcp_server_disabled",
			{
				name: "local-tools",
				disabled: true,
			},
			{ timeoutMs: null },
		);
		expect(
			invoke.mock.calls.filter(
				([command]) => command === "set_mcp_server_disabled",
			),
		).toHaveLength(2);
		expect(retryToggle?.checked).toBe(false);
		expect(
			document.querySelector('[role="dialog"]')?.textContent,
		).not.toContain("Could not update this server");

		await act(async () => detailButton("Close").click());
		const opener = card?.querySelector<HTMLButtonElement>(
			'[aria-label="View local-tools details"]',
		);
		await vi.waitFor(() => expect(document.activeElement).toBe(opener));
		// With nothing pending or failed, the card leads to the server's page.
		await act(async () => opener?.click());
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(onOpenMcp).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				server: expect.objectContaining({ name: "local-tools" }),
			}),
			opener,
		);
	});

	it("labels delete failures and keeps the retry in server details", async () => {
		await renderServers();
		// A failed card action is what brings up a server's details here.
		invoke.mockRejectedValueOnce(new Error("Could not update this server"));
		await act(async () =>
			container
				.querySelector<HTMLInputElement>('[aria-label="Enable local-tools"]')
				?.click(),
		);
		await act(async () => detailButton("Delete local-tools").click());
		invoke.mockRejectedValueOnce(new Error("Could not delete this server"));
		await act(async () =>
			detailButton(
				"Delete",
				document.querySelector('[role="alertdialog"]') as Element,
			).click(),
		);
		const card = container.querySelector('[data-slot="item-card"]');
		expect(card?.querySelector("output")?.textContent).toBe("Delete failed");
		expect(
			card?.querySelector('[data-slot="item-card-actions"] button'),
		).toBeNull();
		const dialog = document.querySelector('[role="dialog"]');
		expect(dialog?.textContent).toContain("Delete failed");
		expect(dialog?.textContent).not.toContain("Connection error");
		expect(
			dialog?.querySelector('[aria-label="Delete local-tools"]'),
		).not.toBeNull();
	});

	it("opens the editor page from a failed-action dialog", async () => {
		const onOpenMcp = vi.fn();
		await renderServers(false, onOpenMcp);
		invoke.mockRejectedValueOnce(new Error("Could not update this server"));
		await act(async () =>
			container
				.querySelector<HTMLInputElement>('[aria-label="Enable local-tools"]')
				?.click(),
		);
		await act(async () => detailButton("Edit local-tools").click());
		expect(onOpenMcp).toHaveBeenCalledWith(
			expect.objectContaining({ server: localServer }),
			expect.anything(),
		);
		expect(document.querySelector("#mcp-name")).toBeNull();
	});

	it("delegates Add to page navigation without opening an editor dialog", async () => {
		const onCreateMcp = vi.fn();
		await renderServers(false, undefined, onCreateMcp);
		const trigger = detailButton("Add MCP server");
		await act(async () => trigger.click());
		expect(onCreateMcp).toHaveBeenCalledExactlyOnceWith(trigger);
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(
			invoke.mock.calls.some(([command]) => command === "upsert_mcp_server"),
		).toBe(false);
	});

	it.each([
		{ disabled: true, lastError: undefined },
		{ disabled: false, lastError: "Your authorization has expired" },
	])("authenticates directly from the card until authorization succeeds (%j)", async ({
		disabled,
		lastError,
	}) => {
		const server: McpServer = {
			name: "remote-tools",
			transportType: "streamableHttp",
			disabled,
			url: "https://example.com/mcp",
			oauthStatus: {
				supported: true,
				configured: false,
				authorizationRequired: true,
				lastError,
			},
		};
		let completeAuthorization!: (value: ReturnType<typeof inventory>) => void;
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_marketplace_installed_entries")
				return { installedKeys: [] };
			if (command === "list_mcp_servers") return inventory([server]);
			if (command === "authorize_mcp_server_oauth")
				return new Promise((resolve) => {
					completeAuthorization = resolve;
				});
			throw new Error(`Unexpected command: ${command}`);
		});
		const onOpenMcp = vi.fn();
		await renderServers(false, onOpenMcp);
		const card = container.querySelector('[data-slot="item-card"]');
		const authenticate = card?.querySelector<HTMLButtonElement>(
			'[aria-label="Authenticate remote-tools"]',
		);
		expect(authenticate?.textContent).toBe("Authenticate");
		expect(authenticate?.disabled).toBe(false);
		expect(card?.querySelector("output")).toBeNull();
		expect(card?.querySelector('[role="switch"]')).toBeNull();
		await act(async () => authenticate?.click());
		expect(invoke).toHaveBeenCalledWith(
			"authorize_mcp_server_oauth",
			{ name: "remote-tools" },
			{ timeoutMs: null },
		);
		expect(onOpenMcp).not.toHaveBeenCalled();
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(authenticate?.disabled).toBe(true);
		expect(authenticate?.textContent).toBe("Authenticating…");
		expect(authenticate?.getAttribute("aria-busy")).toBe("true");
		expect(card?.querySelector('[role="switch"]')).toBeNull();
		await act(async () => authenticate?.click());
		expect(
			invoke.mock.calls.filter(
				([command]) => command === "authorize_mcp_server_oauth",
			),
		).toHaveLength(1);
		await act(async () =>
			completeAuthorization(
				inventory([
					{
						...server,
						disabled: false,
						oauthStatus: {
							supported: true,
							configured: true,
							authorizationRequired: false,
						},
					},
				]),
			),
		);
		expect(card?.querySelector("output")).toBeNull();
		expect(
			card?.querySelector<HTMLInputElement>(
				'[aria-label="Enable remote-tools"]',
			)?.checked,
		).toBe(true);
		expect(
			card?.querySelector('[aria-label="Authenticate remote-tools"]'),
		).toBeNull();
		expect(onOpenMcp).not.toHaveBeenCalled();
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	});

	it("blocks another card's authentication while allowing cancellation in details", async () => {
		const onOpenMcp = vi.fn();
		const server: McpServer = {
			name: "remote-tools",
			transportType: "streamableHttp",
			disabled: true,
			url: "https://example.com/mcp",
			oauthStatus: {
				supported: true,
				configured: false,
				authorizationRequired: true,
			},
		};
		const response = inventory([server, { ...server, name: "other-tools" }]);
		let completeAuthorization!: (value: typeof response) => void;
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_marketplace_installed_entries")
				return { installedKeys: [] };
			if (
				command === "list_mcp_servers" ||
				command === "cancel_mcp_server_oauth"
			)
				return response;
			if (command === "authorize_mcp_server_oauth")
				return new Promise((resolve) => {
					completeAuthorization = resolve;
				});
			throw new Error(`Unexpected command: ${command}`);
		});
		await renderServers(false, onOpenMcp);
		await act(async () => detailButton("Authenticate remote-tools").click());
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		const other = detailButton("Authenticate other-tools");
		expect(other.disabled).toBe(true);
		expect(other.textContent).toBe("Authenticate");
		await act(async () => other.click());
		expect(
			invoke.mock.calls.filter(
				([command]) => command === "authorize_mcp_server_oauth",
			),
		).toHaveLength(1);
		await act(async () => detailButton("View remote-tools details").click());
		expect(onOpenMcp).not.toHaveBeenCalled();
		const dialog = document.querySelector('[role="dialog"]');
		expect(dialog?.textContent).toContain("Waiting for OAuth authorization");
		expect(detailButton("Edit remote-tools").disabled).toBe(true);
		expect(detailButton("Cancel OAuth for remote-tools").disabled).toBe(false);
		await act(async () =>
			detailButton("Cancel OAuth for remote-tools").click(),
		);
		expect(invoke).toHaveBeenCalledWith("cancel_mcp_server_oauth", {
			name: "remote-tools",
		});
		await act(async () => completeAuthorization(response));
		expect(detailButton("Authenticate remote-tools").disabled).toBe(false);
		expect(other.disabled).toBe(false);
		expect(detailButton("Connect remote-tools with OAuth")).toBeDefined();
		expect(detailButton("Edit remote-tools").disabled).toBe(false);
		const trigger = detailButton("View remote-tools details");
		await act(async () => detailButton("Edit remote-tools").click());
		expect(onOpenMcp).toHaveBeenCalledExactlyOnceWith(
			{ server, entry: undefined },
			trigger,
		);
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	});

	it("keeps a pending card toggle in status details until it can hand off to the editor", async () => {
		const onOpenMcp = vi.fn();
		await renderServers(false, onOpenMcp);
		let completeToggle!: (response: ReturnType<typeof inventory>) => void;
		invoke.mockReturnValueOnce(
			new Promise((resolve) => {
				completeToggle = resolve;
			}),
		);
		await act(async () =>
			container
				.querySelector<HTMLInputElement>('[aria-label="Enable local-tools"]')
				?.click(),
		);
		const trigger = detailButton("View local-tools details");
		await act(async () => trigger.click());
		expect(onOpenMcp).not.toHaveBeenCalled();
		expect(document.querySelector('[role="dialog"]')).not.toBeNull();
		expect(detailButton("Edit local-tools").disabled).toBe(true);
		const updated = { ...localServer, disabled: true };
		await act(async () => completeToggle(inventory([updated])));
		expect(detailButton("Edit local-tools").disabled).toBe(false);
		await act(async () => detailButton("Edit local-tools").click());
		expect(onOpenMcp).toHaveBeenCalledExactlyOnceWith(
			{ server: updated, entry: undefined },
			trigger,
		);
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	});

	it("keeps background card failures from opening a dialog over another editor", async () => {
		const other = { ...localServer, name: "other-tools" };
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_mcp_servers")
				return inventory([localServer, other]);
			if (command === "list_marketplace_installed_entries")
				return { installedKeys: [] };
			throw new Error(`Unexpected command: ${command}`);
		});
		const onOpenMcp = vi.fn(() => {
			container.hidden = true;
		});
		await renderServers(false, onOpenMcp);
		let failToggle!: (error: Error) => void;
		invoke.mockReturnValueOnce(
			new Promise((_resolve, reject) => {
				failToggle = reject;
			}),
		);
		await act(async () =>
			container
				.querySelector<HTMLInputElement>('[aria-label="Enable local-tools"]')
				?.click(),
		);
		await act(async () => detailButton("View other-tools details").click());
		expect(onOpenMcp).toHaveBeenCalledOnce();
		await act(async () => failToggle(new Error("Background toggle failed")));
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		container.hidden = false;
		const card = container
			.querySelector('[aria-label="View local-tools details"]')
			?.closest('[data-slot="item-card"]');
		expect(card?.querySelector("output")?.textContent).toBe("Action failed");
	});

	it("shows failed card authentication in details and allows retry from the card", async () => {
		const server: McpServer = {
			name: "remote-tools",
			transportType: "streamableHttp",
			disabled: true,
			url: "https://example.com/mcp",
			oauthStatus: {
				supported: true,
				configured: false,
				authorizationRequired: true,
			},
		};
		let attempts = 0;
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_marketplace_installed_entries")
				return { installedKeys: [] };
			if (command === "list_mcp_servers") return inventory([server]);
			if (command === "authorize_mcp_server_oauth") {
				if (++attempts === 1) throw new Error("Sign-in was canceled");
				return inventory([
					{
						...server,
						disabled: false,
						oauthStatus: {
							supported: true,
							configured: true,
							authorizationRequired: false,
						},
					},
				]);
			}
			throw new Error(`Unexpected command: ${command}`);
		});
		await renderServers();
		await act(async () => detailButton("Authenticate remote-tools").click());
		const dialog = document.querySelector('[role="dialog"]');
		expect(dialog?.textContent).toContain("Sign-in was canceled");
		const card = container.querySelector('[data-slot="item-card"]');
		expect(card?.textContent).not.toContain("Sign-in was canceled");
		expect(detailButton("Authenticate remote-tools").disabled).toBe(false);
		await act(async () => detailButton("Close").click());
		await act(async () => detailButton("Authenticate remote-tools").click());
		expect(attempts).toBe(2);
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(
			card?.querySelector('[aria-label="Authenticate remote-tools"]'),
		).toBeNull();
		expect(
			card?.querySelector<HTMLInputElement>(
				'[aria-label="Enable remote-tools"]',
			)?.checked,
		).toBe(true);
	});

	it("keeps connection failures distinct from authorization requirements", async () => {
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_marketplace_installed_entries")
				return { installedKeys: [] };
			if (command === "list_mcp_servers")
				return inventory([
					{
						...localServer,
						oauthStatus: {
							supported: true,
							configured: true,
							authorizationRequired: false,
							lastError: "Connection timed out",
						},
					},
				]);
			throw new Error(`Unexpected command: ${command}`);
		});
		await renderServers();
		const status = container.querySelector('[data-slot="item-card"] output');
		expect(status?.textContent).toBe("Connection error");
		expect(status?.classList.contains("text-error-text")).toBe(true);
	});

	it("keeps OAuth and configuration details off the card and opens the server's page for them", async () => {
		const server: McpServer = {
			name: "remote-tools",
			transportType: "streamableHttp",
			disabled: true,
			url: "https://example.com/mcp",
			configurationError: "Missing custom configuration",
			oauthStatus: {
				supported: true,
				configured: false,
				authorizationRequired: true,
				lastError: "Sign in again",
			},
		};
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_marketplace_installed_entries")
				return { installedKeys: [] };
			if (command === "list_mcp_servers") return inventory([server]);
			throw new Error(`Unexpected command: ${command}`);
		});
		const onOpenMcp = vi.fn();
		await renderServers(false, onOpenMcp);
		const card = container.querySelector('[data-slot="item-card"]');
		expect(card?.querySelector("output")?.textContent).toBe(
			"Invalid configuration",
		);
		expect(
			card?.querySelector("output")?.classList.contains("text-error-text"),
		).toBe(true);
		expect(
			card?.querySelector('[data-slot="item-card-actions"] button'),
		).toBeNull();
		expect(card?.querySelector('[role="switch"]')).toBeNull();
		expect(card?.textContent).not.toContain("Missing custom configuration");
		expect(card?.textContent).not.toContain("OAuth authorization required");
		expect(card?.textContent).not.toContain("https://example.com/mcp");

		const opener = detailButton("View remote-tools details");
		await act(async () => opener.click());
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(onOpenMcp).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ server }),
			opener,
		);
	});
});

const catalogEntry: MarketplaceEntry = {
	id: "local-tools",
	type: "mcp",
	name: "Published tools",
	tagline: "Tools for projects",
	description: "Manage project data.",
	tags: ["development"],
	author: { name: "Example author" },
	verified: true,
	install: {
		command: "cline",
		args: ["mcp", "add", "local-tools"],
		env: [{ name: "SERVICE_TOKEN", description: "Use a project token" }],
		notes: "Create a project before connecting.",
	},
};
async function renderDetail(
	selection: InstalledMcpSelection = { server: localServer },
	onBack = vi.fn(),
) {
	await act(async () =>
		root.render(
			<InstalledMcpDetailPage selection={selection} onBack={onBack} />,
		),
	);
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	return onBack;
}
function detailButton(label: string, scope: ParentNode = document.body) {
	const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
		(candidate) =>
			candidate.getAttribute("aria-label") === label ||
			candidate.textContent === label,
	);
	expect(button, `Button ${label}`).toBeDefined();
	return button as HTMLButtonElement;
}

async function openSettingsPathMenu(keyboard = false) {
	const advanced = detailButton("Advanced");
	if (advanced.getAttribute("aria-expanded") === "false") {
		await act(async () => advanced.click());
	}
	const trigger = detailButton("MCP settings path actions");
	await act(async () => {
		trigger.dispatchEvent(
			keyboard
				? new KeyboardEvent("keydown", {
						key: "Enter",
						bubbles: true,
						cancelable: true,
					})
				: new MouseEvent("pointerdown", {
						button: 0,
						bubbles: true,
						cancelable: true,
					}),
		);
	});
}

function settingsPathMenuItem(label: string) {
	const item = [
		...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
	].find((candidate) => candidate.textContent === label);
	expect(item, `Menu item ${label}`).toBeDefined();
	return item as HTMLElement;
}

describe("Installed MCP detail page", () => {
	it("opens editable settings directly below the catalog information", async () => {
		const server = { ...localServer, cwd: "/workspace" };
		invoke.mockResolvedValue(inventory([server]));
		const onBack = await renderDetail({
			server,
			entry: { ...catalogEntry, homepage: "https://example.com/local-tools" },
		});
		expect(
			container.querySelector('nav[aria-label="MCP navigation"]'),
		).not.toBeNull();
		expect(
			container.querySelector('form[aria-label="Edit MCP server"]'),
		).not.toBeNull();
		expect(container.querySelector<HTMLInputElement>("#mcp-name")?.value).toBe(
			"local-tools",
		);
		expect(
			container.querySelector<HTMLInputElement>("#mcp-command")?.value,
		).toBe("bun");
		expect(container.querySelector<HTMLInputElement>("#mcp-cwd")?.value).toBe(
			"/workspace",
		);
		expect(container.querySelector('input[type="password"]')).not.toBeNull();
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(
			container.querySelector('[aria-label="Edit local-tools"]'),
		).toBeNull();
		const header = container.querySelector("form header");
		const type = header?.querySelector('[title="Browse MCP servers"]');
		const name = header?.querySelector("#mcp-name");
		const tagline = [...(header?.querySelectorAll("p") ?? [])].find(
			(item) => item.textContent === "Tools for projects",
		);
		const author = [...(header?.querySelectorAll("p") ?? [])].find((item) =>
			item.textContent?.includes("Example author"),
		);
		const learnMore = detailButton("Learn more", header as Element);
		const enable = header?.querySelector('[aria-label="Enable local-tools"]');
		for (const item of [type, name, tagline, author, enable])
			expect(item).toBeTruthy();
		for (const [before, after] of [
			[type, name],
			[name, tagline],
			[tagline, author],
			[author, learnMore],
			[learnMore, enable],
		]) {
			expect(
				(before?.compareDocumentPosition(after as Node) ?? 0) &
					Node.DOCUMENT_POSITION_FOLLOWING,
			).toBeTruthy();
		}
		expect(header?.textContent).toContain("Verified");
		const about = container.querySelector("#mcp-about");
		const settings = container.querySelector("#mcp-settings");
		expect(settings).not.toBeNull();
		expect(settings?.closest("[hidden]")).toBeNull();
		expect(about?.closest("[hidden]")).toBeNull();
		expect(
			(about?.compareDocumentPosition(settings as Node) ?? 0) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(about?.textContent).not.toContain("Example author");
		expect(about?.textContent).toContain("Environment setup");
		expect(about?.textContent).toContain("Create a project before connecting.");
		expect(about?.textContent).not.toContain("test-secret");
		const category = container.querySelector('[title="Filter by development"]');
		expect(category).not.toBeNull();
		expect(category?.closest("#mcp-about, header")).toBeNull();
		await act(async () => detailButton("Back to Manage").click());
		expect(onBack).toHaveBeenCalledOnce();
	});

	it.each([
		["streamableHttp", "Streamable HTTP (recommended)"],
		["sse", "SSE (legacy)"],
	] as const)("opens the saved %s transport in editable settings", async (transportType, typeLabel) => {
		const server: McpServer = {
			name: "remote-tools",
			transportType,
			disabled: false,
			url: "https://example.com/mcp",
		};
		invoke.mockResolvedValue(inventory([server]));
		await renderDetail({ server });
		expect(container.querySelector<HTMLInputElement>("#mcp-url")?.value).toBe(
			server.url,
		);
		expect(container.querySelector('[role="combobox"]')?.textContent).toBe(
			typeLabel,
		);
		expect(container.querySelector("#mcp-command")).toBeNull();
		expect(container.querySelector("#mcp-about")).toBeNull();
	});

	it("copies the settings path with feedback and reveals its file location", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("navigator", { clipboard: { writeText } });
		await renderDetail();
		await openSettingsPathMenu();
		expect(
			[...document.body.querySelectorAll('[role="menuitem"]')].map(
				(item) => item.textContent,
			),
		).toEqual([REVEAL, "Copy path"]);
		expect(writeText).not.toHaveBeenCalled();
		expect(invoke).not.toHaveBeenCalledWith("open_mcp_settings_file");
		await act(async () => settingsPathMenuItem("Copy path").click());
		expect(writeText).toHaveBeenCalledExactlyOnceWith("/settings/mcp.json");
		expect(document.body.querySelector('[role="menu"]')).toBeNull();
		expect(container.querySelector("output")?.textContent).toBe(
			"MCP settings path copied.",
		);
		expect(invoke).not.toHaveBeenCalledWith("open_mcp_settings_file");
		invoke.mockResolvedValueOnce("/settings/mcp.json");
		await openSettingsPathMenu();
		await act(async () => settingsPathMenuItem(REVEAL).click());
		expect(invoke).toHaveBeenCalledWith("reveal_path", {
			path: "/settings/mcp.json",
		});
		expect(invoke).not.toHaveBeenCalledWith("open_mcp_settings_file");
	});

	it("reports a clipboard failure without showing copied feedback", async () => {
		const writeText = vi.fn().mockRejectedValue(new Error("Clipboard denied"));
		vi.stubGlobal("navigator", { clipboard: { writeText } });
		await renderDetail();
		await openSettingsPathMenu(true);
		await act(async () => {
			settingsPathMenuItem("Copy path").dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		const connection = container;
		expect(connection?.querySelector('[role="alert"]')?.textContent).toContain(
			"Could not copy mcp settings path.",
		);
		expect(document.body.querySelector('[role="menu"]')).toBeNull();
		expect(connection?.querySelector("output")?.textContent).toBe("");
	});

	it("disables both path actions when the settings path is unavailable", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("navigator", { clipboard: { writeText } });
		invoke.mockResolvedValue({ ...inventory(), settingsPath: "" });
		await renderDetail();
		await openSettingsPathMenu();
		for (const label of [REVEAL, "Copy path"]) {
			const item = settingsPathMenuItem(label);
			expect(item.getAttribute("aria-disabled")).toBe("true");
			await act(async () => item.click());
		}
		expect(writeText).not.toHaveBeenCalled();
		expect(invoke).not.toHaveBeenCalledWith("reveal_path", expect.anything());
		expect(invoke).not.toHaveBeenCalledWith("open_mcp_settings_file");
	});

	it("opens the marketplace Learn more URL from About", async () => {
		await renderDetail({
			server: localServer,
			entry: { ...catalogEntry, homepage: "https://example.com/local-tools" },
		});
		const learnMore = detailButton("Learn more");
		expect(
			[...container.querySelectorAll("button")].filter(
				(button) => button.textContent === "Learn more",
			),
		).toHaveLength(1);
		await act(async () => learnMore.click());
		expect(openExternalUrl).toHaveBeenCalledExactlyOnceWith(
			"https://example.com/local-tools",
		);
	});

	it("preserves the immediate enable state while renaming and stays on the page after Save", async () => {
		let current = localServer;
		invoke.mockImplementation(
			async (
				command: string,
				args?: { disabled?: boolean; input?: Partial<McpServer> },
			) => {
				if (command === "list_mcp_servers") return inventory([current]);
				if (command === "set_mcp_server_disabled") {
					current = { ...current, disabled: args?.disabled ?? false };
					return inventory([current]);
				}
				if (command === "upsert_mcp_server") {
					current = { ...current, ...args?.input };
					return inventory([current]);
				}
				throw new Error(`Unexpected command: ${command}`);
			},
		);
		const onBack = await renderDetail();
		await act(async () =>
			container
				.querySelector<HTMLInputElement>('[aria-label="Enable local-tools"]')
				?.click(),
		);
		expect(getCachedMcpServers()?.servers[0]?.disabled).toBe(true);
		const input = document.querySelector<HTMLInputElement>("#mcp-name");
		expect(input).not.toBeNull();
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set?.call(input, "renamed-tools");
			input?.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await act(async () => detailButton("Save").click());
		expect(invoke).toHaveBeenCalledWith(
			"upsert_mcp_server",
			{
				input: expect.objectContaining({
					name: "renamed-tools",
					previousName: "local-tools",
					disabled: true,
				}),
			},
			{ timeoutMs: null },
		);
		expect(getCachedMcpServers()?.servers[0]?.name).toBe("renamed-tools");
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(onBack).not.toHaveBeenCalled();
		expect(detailButton("Saved").disabled).toBe(false);
	});

	it("returns once when a successful inventory update removes the open server", async () => {
		const onBack = await renderDetail();
		await act(async () => {
			commitMcpServersResponse(inventory([]));
		});
		expect(onBack).toHaveBeenCalledExactlyOnceWith({ uninstalled: true });
		expect(
			container.querySelector('[aria-label="Edit local-tools"]'),
		).toBeNull();
		expect(container.querySelector('[data-slot="item-card"]')).toBeNull();
		await act(async () => {
			commitMcpServersResponse(inventory([]));
		});
		expect(onBack).toHaveBeenCalledOnce();
	});

	it("keeps deletion errors on the page and returns only after a confirmed successful delete", async () => {
		const onBack = await renderDetail();
		invoke.mockRejectedValueOnce(new Error("Could not delete this server"));
		await act(async () => detailButton("Delete local-tools").click());
		await act(async () =>
			detailButton(
				"Delete",
				document.querySelector('[role="alertdialog"]') as Element,
			).click(),
		);
		expect(container.textContent).toContain("Could not delete this server");
		expect(container.textContent).toContain("Delete failed");
		expect(container.textContent).not.toContain("Connection error");
		expect(onBack).not.toHaveBeenCalled();
		invoke.mockResolvedValueOnce(inventory([]));
		await act(async () => detailButton("Delete local-tools").click());
		await act(async () =>
			detailButton(
				"Delete",
				document.querySelector('[role="alertdialog"]') as Element,
			).click(),
		);
		expect(invoke).toHaveBeenCalledWith(
			"delete_mcp_server",
			{
				name: "local-tools",
			},
			{ timeoutMs: null },
		);
		expect(onBack).toHaveBeenCalledExactlyOnceWith({ uninstalled: true });
		expect(getCachedMcpServers()?.servers).toEqual([]);
	});

	it("preserves configuration alerts and OAuth actions on the standalone page", async () => {
		const server: McpServer = {
			name: "remote-tools",
			transportType: "streamableHttp",
			disabled: true,
			url: "https://example.com/mcp",
			configurationError: "Missing custom configuration",
			oauthStatus: {
				supported: true,
				configured: false,
				authorizationRequired: true,
			},
		};
		let complete!: (response: ReturnType<typeof inventory>) => void;
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_mcp_servers") return inventory([server]);
			if (command === "authorize_mcp_server_oauth")
				return new Promise((resolve) => {
					complete = resolve;
				});
			throw new Error(`Unexpected command: ${command}`);
		});
		await renderDetail({ server });
		expect(container.textContent).toContain("Missing custom configuration");
		await act(async () =>
			detailButton("Connect remote-tools with OAuth").click(),
		);
		expect(invoke).toHaveBeenCalledWith(
			"authorize_mcp_server_oauth",
			{ name: "remote-tools" },
			{ timeoutMs: null },
		);
		expect(container.textContent).toContain("Waiting for OAuth authorization");
		expect(detailButton("Cancel OAuth for remote-tools")).toBeDefined();
		expect(detailButton("Save").disabled).toBe(true);
		await act(async () =>
			complete(
				inventory([
					{
						...server,
						disabled: false,
						configurationError: undefined,
						oauthStatus: {
							supported: true,
							configured: true,
							authorizationRequired: false,
						},
					},
				]),
			),
		);
		expect(container.textContent).toContain("OAuth connected");
		expect(container.textContent).not.toContain("Missing custom configuration");
		expect(
			container.querySelector<HTMLInputElement>(
				'[aria-label="Enable remote-tools"]',
			)?.checked,
		).toBe(true);
	});
});

describe("host-owned MCP search", () => {
	it("searches safe configuration fields while keeping only the enable control on cards", async () => {
		await act(async () =>
			root.render(<McpServers searchQuery=" BUN " searchResults />),
		);
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		expect(container.querySelectorAll('[data-slot="item-card"]')).toHaveLength(
			1,
		);
		expect(container.textContent).toContain("local-tools");
		expect(
			container.querySelector('[data-slot="scroll-area-viewport"]'),
		).toBeNull();
		expect(
			container.querySelector('[aria-label="Edit local-tools"]'),
		).toBeNull();
		expect(
			container.querySelector('[aria-label="Delete local-tools"]'),
		).toBeNull();
		expect(
			container.querySelector('[aria-label="Enable local-tools"]'),
		).not.toBeNull();
		expect(container.querySelector('input[type="text"]')).toBeNull();
		expect(container.textContent).not.toContain("MCP settings path:");
		expect(container.textContent).not.toContain("Editing this list updates");
	});
	it.each([
		"test-secret",
		"SERVICE_TOKEN",
		"private-header",
	])("does not search secret configuration values: %s", async (query) => {
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_mcp_servers")
				return inventory([
					{ ...localServer, headers: { Authorization: "private-header" } },
				]);
			if (command === "list_marketplace_installed_entries")
				return { installedKeys: [] };
			throw new Error(`Unexpected command: ${command}`);
		});
		await act(async () =>
			root.render(<McpServers searchQuery={query} searchResults />),
		);
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		expect(container.querySelector('[data-slot="item-card"]')).toBeNull();
		expect(container.textContent).toBe("");
	});
	it("shows neither results nor an empty state until local servers finish loading", async () => {
		let resolveInventory!: (response: ReturnType<typeof inventory>) => void;
		const pendingInventory = new Promise((resolve) => {
			resolveInventory = resolve;
		});
		invoke.mockImplementation((command: string) =>
			command === "list_mcp_servers"
				? pendingInventory
				: Promise.resolve({ installedKeys: [] }),
		);
		await act(async () =>
			root.render(<McpServers searchQuery="local-tools" searchResults />),
		);
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		expect(container.textContent).toBe("");
		await act(async () => resolveInventory(inventory()));
		expect(container.querySelectorAll('[data-slot="item-card"]')).toHaveLength(
			1,
		);
		expect(container.textContent).toContain("local-tools");
	});
});

describe("cached MCP inventory", () => {
	it("restores servers immediately on remount and keeps them during background refresh", async () => {
		const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
		try {
			await renderServers();
			expect(container.textContent).toContain("local-tools");
			await act(async () => root.render(null));
			await renderServers();
			expect(container.textContent).toContain("local-tools");
			expect(
				invoke.mock.calls.filter(([command]) => command === "list_mcp_servers"),
			).toHaveLength(1);
			await act(async () => root.render(null));
			now.mockReturnValue(62_000);
			let complete!: (value: ReturnType<typeof inventory>) => void;
			invoke.mockImplementation((command: string) =>
				command === "list_mcp_servers"
					? new Promise((resolve) => {
							complete = resolve;
						})
					: Promise.resolve({ installedKeys: [] }),
			);
			await renderServers();
			expect(container.textContent).toContain("local-tools");
			expect(
				container
					.querySelector('[aria-label="Refresh MCP servers"]')
					?.getAttribute("disabled"),
			).toBeNull();
			await act(async () =>
				complete(inventory([{ ...localServer, name: "updated-tools" }])),
			);
			expect(container.textContent).toContain("updated-tools");
			expect(container.textContent).not.toContain("local-tools");
		} finally {
			now.mockRestore();
		}
	});
});
