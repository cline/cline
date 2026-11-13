// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	commitMcpServersResponse,
	getCachedMcpServers,
	invalidateExtensionInventoryCache,
	type McpServer,
} from "@/lib/extension-inventory";
import type { MarketplaceEntry } from "@/lib/marketplace";
import { McpServerEditorPage } from "./mcp-server-editor-page";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke, subscribe: () => () => {} },
	openExternalUrl: vi.fn(),
}));

const localServer: McpServer = {
	name: "local-tools",
	transportType: "stdio",
	disabled: false,
	command: "bun",
	args: ["server.ts"],
	env: { SERVICE_TOKEN: "secret-value" },
};
const catalogEntry: MarketplaceEntry = {
	id: "local-tools",
	type: "mcp",
	name: "Project tools",
	tagline: "Tools for projects",
	description: "Manage project data.",
	tags: ["development"],
	install: { command: "bun", args: ["server.ts"] },
};
const inventory = (servers: McpServer[] = [localServer]) => ({
	settingsPath: "/settings/mcp.json",
	hasSettingsFile: true,
	servers,
});

let container: HTMLDivElement;
let root: Root;
let titleBottom: number;

beforeEach(() => {
	invalidateExtensionInventoryCache();
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	titleBottom = 240;
	const getBounds = HTMLElement.prototype.getBoundingClientRect;
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		function (this: HTMLElement) {
			if (this.matches("form h1"))
				return new DOMRect(0, titleBottom - 32, 400, 32);
			if (this.hasAttribute("data-item-scroll-header"))
				return new DOMRect(0, 0, 800, 64);
			return getBounds.call(this);
		},
	);
	invoke.mockReset();
	invoke.mockImplementation(async (command: string) => {
		if (command === "list_mcp_servers") return inventory();
		throw new Error(`Unexpected command: ${command}`);
	});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

async function mount(
	server: McpServer | undefined = localServer,
	entry?: MarketplaceEntry,
	onBack = vi.fn(),
) {
	await act(async () => {
		root.render(
			<McpServerEditorPage server={server} entry={entry} onBack={onBack} />,
		);
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	return onBack;
}

async function mountNew(onBack = vi.fn()) {
	await act(async () => {
		root.render(<McpServerEditorPage onBack={onBack} />);
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	return onBack;
}

function button(label: string, scope: ParentNode = container) {
	const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
		(candidate) =>
			!candidate.closest("[inert], [hidden]") &&
			(candidate.getAttribute("aria-label") === label ||
				candidate.textContent === label),
	);
	expect(found, `Button ${label}`).toBeDefined();
	return found as HTMLButtonElement;
}

async function changeField(id: string, value: string) {
	const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
		`#${id}`,
	);
	expect(input, `Field ${id}`).not.toBeNull();
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			input instanceof HTMLTextAreaElement
				? HTMLTextAreaElement.prototype
				: HTMLInputElement.prototype,
			"value",
		)?.set?.call(input, value);
		input?.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

/** Saving keeps the editor open on the saved server and confirms it. */
function expectSavedInPlace(onBack: ReturnType<typeof vi.fn>) {
	expect(onBack).not.toHaveBeenCalled();
	expect(button("Saved").disabled).toBe(false);
	expect(
		container.querySelector('form[aria-label="Edit MCP server"]'),
	).not.toBeNull();
}

function confirmationButton(label: string) {
	return button(
		label,
		document.querySelector('[role="alertdialog"]') ??
			document.createElement("div"),
	);
}

function saveCalls() {
	return invoke.mock.calls.filter(
		([command]) => command === "upsert_mcp_server",
	);
}

describe("MCP server editor page", () => {
	it("validates new local servers and saves the enabled default", async () => {
		const onBack = await mountNew();
		expect(
			container.querySelector('form[aria-label="New MCP server"]'),
		).not.toBeNull();
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(
			container.querySelector<HTMLInputElement>("#mcp-enabled")?.checked,
		).toBe(true);
		expect(container.querySelector('[aria-label^="Delete "]')).toBeNull();
		expect(document.activeElement).toBe(container.querySelector("#mcp-name"));
		await act(async () => button("Save").click());
		expect(container.textContent).toContain("Server name is required.");
		await changeField("mcp-name", "  new-tools  ");
		await act(async () => button("Save").click());
		expect(container.textContent).toContain(
			"Command is required for local servers.",
		);
		expect(saveCalls()).toHaveLength(0);
		await changeField("mcp-command", "  bun  ");
		await changeField("mcp-args", "run, server.ts");
		invoke.mockResolvedValueOnce(
			inventory([{ ...localServer, name: "new-tools" }]),
		);
		await act(async () => button("Save").click());
		expect(invoke).toHaveBeenCalledWith(
			"upsert_mcp_server",
			{
				input: expect.objectContaining({
					name: "new-tools",
					previousName: undefined,
					transportType: "stdio",
					command: "bun",
					args: ["run", "server.ts"],
					disabled: false,
				}),
			},
			{ timeoutMs: null },
		);
		expectSavedInPlace(onBack);
		// The page now edits the server it created.
		expect(button("Delete new-tools").disabled).toBe(false);
		await changeField("mcp-command", "node");
		expect(button("Save").disabled).toBe(false);
		invoke.mockResolvedValueOnce(
			inventory([{ ...localServer, name: "new-tools", command: "node" }]),
		);
		await act(async () => button("Save").click());
		expect(saveCalls()[1]?.[1]).toMatchObject({
			input: { name: "new-tools", previousName: "new-tools", command: "node" },
		});
	});

	it("allows creation without enabling the server", async () => {
		await mountNew();
		await changeField("mcp-name", "disabled-tools");
		await changeField("mcp-command", "bun");
		await act(async () =>
			container.querySelector<HTMLInputElement>("#mcp-enabled")?.click(),
		);
		expect(
			invoke.mock.calls.some(
				([command]) => command === "set_mcp_server_disabled",
			),
		).toBe(false);
		invoke.mockResolvedValueOnce(
			inventory([{ ...localServer, name: "disabled-tools", disabled: true }]),
		);
		await act(async () => button("Save").click());
		expect(saveCalls()[0]?.[1]).toMatchObject({
			input: { name: "disabled-tools", disabled: true },
		});
	});

	it.each([
		"streamableHttp",
		"sse",
	] as const)("preserves remote %s settings and validates the URL", async (transportType) => {
		const server: McpServer = {
			name: "remote-tools",
			transportType,
			disabled: true,
			url: "https://example.com/mcp",
			headers: { Authorization: "Bearer token" },
			metadata: { project: "test" },
		};
		invoke.mockResolvedValue(inventory([server]));
		const onBack = await mount(server);
		await changeField("mcp-url", "");
		await act(async () => button("Save").click());
		expect(container.textContent).toContain(
			"Server URL is required for remote servers.",
		);
		expect(saveCalls()).toHaveLength(0);
		await changeField("mcp-url", "https://example.com/new-mcp");
		await act(async () => button("Save").click());
		expect(saveCalls()[0]?.[1]).toMatchObject({
			input: {
				name: server.name,
				previousName: server.name,
				transportType,
				disabled: true,
				url: "https://example.com/new-mcp",
				headers: server.headers,
				metadata: server.metadata,
			},
		});
		expectSavedInPlace(onBack);
	});

	it("preserves the draft after validation and request failures, focusing feedback for retry", async () => {
		const onBack = await mount();
		await changeField("mcp-command", "node");
		await act(async () => button("Advanced").click());
		await changeField("mcp-metadata", "{invalid");
		await act(async () => button("Save").click());
		expect(saveCalls()).toHaveLength(0);
		expect(onBack).not.toHaveBeenCalled();
		await changeField("mcp-metadata", '{"project":"test"}');
		invoke.mockRejectedValueOnce(new Error("Could not save this server"));
		await act(async () => button("Save").click());
		expect(container.textContent).toContain("Could not save this server");
		expect(document.activeElement?.textContent).toContain(
			"Could not save this server",
		);
		expect(
			container.querySelector<HTMLInputElement>("#mcp-command")?.value,
		).toBe("node");
		expect(onBack).not.toHaveBeenCalled();
		invoke.mockResolvedValueOnce(
			inventory([{ ...localServer, command: "node" }]),
		);
		await act(async () => button("Save").click());
		expect(saveCalls()).toHaveLength(2);
		expectSavedInPlace(onBack);
	});

	it("persists Enable using the saved identity and preserves other draft edits on inventory updates", async () => {
		const onBack = await mount();
		await changeField("mcp-name", "renamed-tools");
		await changeField("mcp-command", "node");
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
		expect(saveCalls()).toHaveLength(0);
		await act(async () =>
			commitMcpServersResponse(
				inventory([
					{ ...localServer, command: "external-command", disabled: true },
				]),
			),
		);
		expect(container.querySelector<HTMLInputElement>("#mcp-name")?.value).toBe(
			"renamed-tools",
		);
		expect(
			container.querySelector<HTMLInputElement>("#mcp-command")?.value,
		).toBe("node");
		invoke.mockResolvedValueOnce(
			inventory([
				{
					...localServer,
					name: "renamed-tools",
					command: "node",
					disabled: true,
				},
			]),
		);
		await act(async () => button("Save").click());
		expect(saveCalls()[0]?.[1]).toMatchObject({
			input: {
				name: "renamed-tools",
				previousName: "local-tools",
				command: "node",
				disabled: true,
			},
		});
		expect(getCachedMcpServers()?.servers[0]?.name).toBe("renamed-tools");
		expectSavedInPlace(onBack);
		expect(button("Delete renamed-tools").disabled).toBe(false);
	});

	it("shows About above Settings and keeps the draft intact when catalog information updates", async () => {
		const onBack = await mount(localServer, catalogEntry);
		const command = container.querySelector<HTMLInputElement>("#mcp-command");
		const about = container.querySelector("#mcp-about");
		const settings = container.querySelector("#mcp-settings");
		expect(about).not.toBeNull();
		expect(settings).not.toBeNull();
		expect(about?.closest("[hidden]")).toBeNull();
		expect(settings?.closest("[hidden]")).toBeNull();
		expect(
			(about?.compareDocumentPosition(settings as Node) ?? 0) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			container.querySelector('[aria-label="MCP server sections"]'),
		).toBeNull();
		await changeField("mcp-command", "node");
		expect(about?.textContent).toContain("Manage project data.");
		expect(about?.textContent).not.toContain("secret-value");
		await act(async () =>
			root.render(
				<McpServerEditorPage
					server={localServer}
					entry={{
						...catalogEntry,
						description: "Updated project information.",
					}}
					onBack={onBack}
				/>,
			),
		);
		expect(about?.textContent).toContain("Updated project information.");
		expect(container.querySelector("#mcp-command")).toBe(command);
		expect(command?.closest("[hidden]")).toBeNull();
		expect(command?.value).toBe("node");
	});

	it("blocks duplicate submissions and conflicting actions while Save is pending", async () => {
		const onBack = await mount();
		let complete!: (response: ReturnType<typeof inventory>) => void;
		invoke.mockReturnValueOnce(
			new Promise((resolve) => {
				complete = resolve;
			}),
		);
		const form = container.querySelector("form");
		await act(async () => {
			form?.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
			form?.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
		});
		expect(saveCalls()).toHaveLength(1);
		expect(button("Saving…").disabled).toBe(true);
		expect(button("Back to Manage").disabled).toBe(true);
		expect(button("Delete local-tools").disabled).toBe(true);
		expect(
			container
				.querySelector<HTMLInputElement>("#mcp-name")
				?.matches(":disabled"),
		).toBe(true);
		expect(
			container
				.querySelector<HTMLInputElement>("#mcp-command")
				?.matches(":disabled"),
		).toBe(true);
		expect(
			container.querySelector<HTMLInputElement>(
				'[aria-label="Enable local-tools"]',
			)?.disabled,
		).toBe(true);
		await act(async () => button("Back to Manage").click());
		expect(onBack).not.toHaveBeenCalled();
		await act(async () => complete(inventory()));
		expectSavedInPlace(onBack);
		expect(button("Back to Manage").disabled).toBe(false);
	});

	it("does not navigate after an old Save completes following unmount", async () => {
		const onBack = await mount();
		let complete!: (response: ReturnType<typeof inventory>) => void;
		invoke.mockReturnValueOnce(
			new Promise((resolve) => {
				complete = resolve;
			}),
		);
		await act(async () => button("Save").click());
		await act(async () => root.render(null));
		await act(async () => complete(inventory()));
		expect(onBack).not.toHaveBeenCalled();
	});

	it("keeps OAuth cancellation available while blocking edits and preserves the draft", async () => {
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
		let completeAuthorization!: (
			response: ReturnType<typeof inventory>,
		) => void;
		invoke.mockImplementation(async (command: string) => {
			if (
				command === "list_mcp_servers" ||
				command === "cancel_mcp_server_oauth"
			)
				return inventory([server]);
			if (command === "authorize_mcp_server_oauth")
				return new Promise((resolve) => {
					completeAuthorization = resolve;
				});
			throw new Error(`Unexpected command: ${command}`);
		});
		await mount(server);
		await changeField("mcp-url", "https://example.com/unsaved");
		await act(async () => button("Connect remote-tools with OAuth").click());
		expect(invoke).toHaveBeenCalledWith(
			"authorize_mcp_server_oauth",
			{ name: "remote-tools" },
			{ timeoutMs: null },
		);
		expect(button("Save").disabled).toBe(true);
		expect(button("Delete remote-tools").disabled).toBe(true);
		const cancel = button("Cancel OAuth for remote-tools");
		expect(cancel.disabled).toBe(false);
		await act(async () => cancel.click());
		expect(invoke).toHaveBeenCalledWith("cancel_mcp_server_oauth", {
			name: "remote-tools",
		});
		await act(async () => completeAuthorization(inventory([server])));
		expect(button("Save").disabled).toBe(false);
		expect(button("Connect remote-tools with OAuth").disabled).toBe(false);
		expect(container.querySelector<HTMLInputElement>("#mcp-url")?.value).toBe(
			"https://example.com/unsaved",
		);
		expect(saveCalls()).toHaveLength(0);
	});

	it("goes back at once when nothing changed", async () => {
		const onBack = await mount();
		await act(async () => button("Back to Manage").click());
		expect(document.querySelector('[role="alertdialog"]')).toBeNull();
		expect(onBack).toHaveBeenCalledOnce();
	});

	it("asks before Back discards a draft and starts a reopened editor from persisted settings", async () => {
		const onBack = await mount();
		expect(document.activeElement).toBe(button("Back to Manage"));
		await changeField("mcp-name", "discard-this-name");
		await changeField("mcp-command", "discard-this-command");
		await act(async () => button("Back to Manage").click());
		expect(
			document.querySelector('[role="alertdialog"]')?.textContent,
		).toContain("Discard unsaved changes?");
		expect(onBack).not.toHaveBeenCalled();
		await act(async () => confirmationButton("Keep editing").click());
		expect(container.querySelector<HTMLInputElement>("#mcp-name")?.value).toBe(
			"discard-this-name",
		);
		await act(async () => button("Back to Manage").click());
		await act(async () => confirmationButton("Discard").click());
		expect(onBack).toHaveBeenCalledOnce();
		expect(saveCalls()).toHaveLength(0);
		await act(async () => root.render(null));
		await mount();
		expect(container.querySelector<HTMLInputElement>("#mcp-name")?.value).toBe(
			"local-tools",
		);
		expect(
			container.querySelector<HTMLInputElement>("#mcp-command")?.value,
		).toBe("bun");
		await act(async () => root.render(null));
		await mountNew();
		expect(container.querySelector<HTMLInputElement>("#mcp-name")?.value).toBe(
			"",
		);
		expect(
			container.querySelector<HTMLInputElement>("#mcp-command")?.value,
		).toBe("");
	});

	it.each([
		false,
		true,
	])("submits the current draft from header Save after scrolling (new: %s)", async (isNew) => {
		const onBack = isNew ? await mountNew() : await mount();
		await changeField("mcp-name", "saved-tools");
		await changeField("mcp-command", "node");
		const save = button("Save");
		expect(save.closest('[data-item-header-actions="inline"]')).not.toBeNull();
		titleBottom = 0;
		const viewport = container
			.querySelector("form")
			?.closest('[data-slot="scroll-area-viewport"]');
		expect(viewport).not.toBeNull();
		await act(async () => viewport?.dispatchEvent(new Event("scroll")));
		expect(button("Save")).toBe(save);
		expect(save.form).toBe(container.querySelector("form"));
		invoke.mockResolvedValueOnce(
			inventory([{ ...localServer, name: "saved-tools", command: "node" }]),
		);
		await act(async () => save.click());
		expect(saveCalls()[0]?.[1]).toMatchObject({
			input: { name: "saved-tools", command: "node" },
		});
		expectSavedInPlace(onBack);
	});
});
