// @vitest-environment jsdom

import { act, type ReactNode, useMemo, useReducer } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createDesktopAppState,
	desktopAppReducer,
} from "@/lib/desktop-app-state";
import {
	type DetailNavigationHost,
	DetailNavigationProvider,
} from "@/lib/detail-navigation";
import {
	invalidateExtensionInventoryCache,
	type McpServer,
} from "@/lib/extension-inventory";
import { CustomizePage } from "./customize-page";
import type { InstalledCustomizationActions } from "./installed-customization-sections";
import type { McpServerUpsertInput } from "./mcp/mcp-types";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	servers: [] as McpServer[],
	openMcp: (_server: McpServer) => {},
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke, subscribe: () => () => {} },
	openExternalUrl: vi.fn(),
}));
vi.mock("@/lib/use-marketplace-directory", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/use-marketplace-directory")>()),
	MarketplaceActionsProvider: ({ children }: { children: ReactNode }) =>
		children,
}));
vi.mock("./navigation/customize-category-filter", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("./navigation/customize-category-filter")
	>()),
	CustomizeCategoryFilterProvider: ({ children }: { children: ReactNode }) =>
		children,
}));
vi.mock("./manage-customizations-view", () => ({
	ManageCustomizationsView: ({
		actions,
	}: {
		actions: InstalledCustomizationActions;
	}) => {
		mocks.openMcp = (server) => actions.onOpenMcp({ server });
		return (
			<>
				<button
					type="button"
					onClick={() => {
						const server = mocks.servers[0];
						if (server) actions.onOpenMcp({ server });
					}}
				>
					Open MCP server
				</button>
				<button type="button" onClick={() => actions.onCreateMcp()}>
					New MCP server
				</button>
			</>
		);
	},
}));

const localServer: McpServer = {
	name: "local-tools",
	transportType: "stdio",
	command: "bun",
	disabled: false,
};
const remoteServer: McpServer = {
	name: "remote-tools",
	transportType: "streamableHttp",
	url: "https://example.com/original",
	disabled: false,
};
const inventory = () => ({
	servers: mocks.servers,
	settingsPath: "/settings/mcp.json",
	hasSettingsFile: true,
});
const appHistory = { back: () => {}, forward: () => {} };

function HostedCustomizeHarness() {
	const [state, dispatch] = useReducer(
		desktopAppReducer<"General">,
		undefined,
		() => {
			const initial = createDesktopAppState("draft", "General", "local");
			return desktopAppReducer(initial, {
				type: "navigate",
				destination: {
					...initial.navigation.current,
					view: "customize",
					customizeSection: "manage",
				},
			});
		},
	);
	const current = state.navigation.current;
	const host = useMemo<DetailNavigationHost>(
		() => ({
			detail: current.detail,
			open: (detail) =>
				dispatch({ type: "navigate", destination: { ...current, detail } }),
			replace: (detail, replacement) =>
				dispatch({ type: "replace-detail", detail, replacement }),
			close: (detail, options) =>
				dispatch({ type: "close-detail", detail, forget: options?.forget }),
		}),
		[current],
	);
	appHistory.back = () => dispatch({ type: "back" });
	appHistory.forward = () => dispatch({ type: "forward" });
	return (
		<DetailNavigationProvider value={host}>
			<CustomizePage
				section={current.customizeSection}
				customizeCategory="mcp"
				onCustomizeCategoryChange={() => {}}
				onNavigateSection={() => {}}
				onOpenModelProviders={() => {}}
			/>
		</DetailNavigationProvider>
	);
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	invalidateExtensionInventoryCache();
	mocks.servers = [localServer];
	mocks.invoke.mockReset();
	mocks.invoke.mockImplementation(
		async (command: string, args?: { input: McpServerUpsertInput }) => {
			if (command === "list_mcp_servers") return inventory();
			if (command === "upsert_mcp_server" && args) {
				const { previousName, ...input } = args.input;
				mocks.servers = [
					...mocks.servers.filter((server) => server.name !== previousName),
					{ ...input, disabled: input.disabled ?? false },
				];
				return inventory();
			}
			throw new Error(`Unexpected command: ${command}`);
		},
	);
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function button(label: string) {
	const found = [
		...container.querySelectorAll<HTMLButtonElement>("button"),
	].find(
		(candidate) =>
			!candidate.closest("[hidden], [inert]") &&
			(candidate.getAttribute("aria-label") === label ||
				candidate.textContent === label),
	);
	expect(found, `Button ${label}`).toBeDefined();
	return found as HTMLButtonElement;
}

function field(id: string) {
	const input = container.querySelector<HTMLInputElement>(`#${id}`);
	expect(input, `Field ${id}`).not.toBeNull();
	return input as HTMLInputElement;
}

async function changeField(id: string, value: string) {
	await act(async () => {
		const input = field(id);
		Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)?.set?.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

async function saveAndRevisit() {
	await act(async () => button("Save").click());
	expect(button("Saved").disabled).toBe(false);
	await act(async () => appHistory.back());
	expect(
		container.querySelector('form[aria-label="Edit MCP server"]'),
	).toBeNull();
	await act(async () => appHistory.forward());
	expect(
		container.querySelector('form[aria-label="Edit MCP server"]'),
	).not.toBeNull();
}

describe("MCP detail history", () => {
	it("resets the editor when history moves directly between different servers", async () => {
		mocks.servers = [localServer, remoteServer];
		await act(async () => root.render(<HostedCustomizeHarness />));
		await act(async () => mocks.openMcp(localServer));
		expect(field("mcp-command").value).toBe("bun");
		await act(async () => mocks.openMcp(remoteServer));
		expect(field("mcp-url").value).toBe(remoteServer.url);
		await act(async () => appHistory.back());
		expect(field("mcp-name").value).toBe(localServer.name);
		expect(field("mcp-command").value).toBe("bun");
		await act(async () => appHistory.forward());
		expect(field("mcp-name").value).toBe(remoteServer.name);
		expect(field("mcp-url").value).toBe(remoteServer.url);
	});

	it.each([
		{ server: localServer, field: "mcp-command", value: "node" },
		{
			server: remoteServer,
			field: "mcp-url",
			value: "https://example.com/updated",
		},
	])("restores saved $field after Back and Forward", async (testCase) => {
		mocks.servers = [testCase.server];
		await act(async () => root.render(<HostedCustomizeHarness />));
		await act(async () => button("Open MCP server").click());
		await changeField(testCase.field, testCase.value);
		await saveAndRevisit();
		expect(field(testCase.field).value).toBe(testCase.value);
		await act(async () => button("Save").click());
		expect(mocks.servers[0]).toMatchObject({
			name: testCase.server.name,
			[testCase.field === "mcp-command" ? "command" : "url"]: testCase.value,
		});
	});

	it("restores a renamed server without losing its Saved confirmation", async () => {
		await act(async () => root.render(<HostedCustomizeHarness />));
		await act(async () => button("Open MCP server").click());
		await changeField("mcp-name", "renamed-tools");
		await saveAndRevisit();
		expect(field("mcp-name").value).toBe("renamed-tools");
		await act(async () => button("Save").click());
		expect(mocks.invoke).toHaveBeenLastCalledWith(
			"upsert_mcp_server",
			{ input: expect.objectContaining({ previousName: "renamed-tools" }) },
			{ timeoutMs: null },
		);
		expect(mocks.servers).toHaveLength(1);
	});

	it("reopens a newly saved server as an existing editor", async () => {
		mocks.servers = [];
		await act(async () => root.render(<HostedCustomizeHarness />));
		await act(async () => button("New MCP server").click());
		await changeField("mcp-name", "new-tools");
		await changeField("mcp-command", "node");
		await saveAndRevisit();
		expect(field("mcp-name").value).toBe("new-tools");
		expect(field("mcp-command").value).toBe("node");
		await act(async () => button("Save").click());
		expect(mocks.invoke).toHaveBeenLastCalledWith(
			"upsert_mcp_server",
			{ input: expect.objectContaining({ previousName: "new-tools" }) },
			{ timeoutMs: null },
		);
		expect(mocks.servers).toHaveLength(1);
	});
});
