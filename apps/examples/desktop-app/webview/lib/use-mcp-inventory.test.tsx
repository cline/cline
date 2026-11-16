// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	commitExtensionInventoryResponse,
	commitMcpServersResponse,
	invalidateExtensionInventoryCache,
	type McpServersResponse,
} from "./extension-inventory";
import { useExtensionInventory } from "./use-extension-inventory";
import { useMcpInventory } from "./use-mcp-inventory";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("./desktop-client", () => ({
	desktopClient: { invoke, subscribe: () => () => {} },
}));

let root: Root;
let container: HTMLDivElement;
function Inventory({ name }: { name: string }) {
	const { response, loading, error, refresh } = useMcpInventory();
	return (
		<>
			<output aria-label={name}>
				{loading
					? "Loading"
					: response?.servers.map((server) => server.name).join(",")}
				{error ? `Error: ${error}` : ""}
			</output>
			<button
				type="button"
				aria-label={`Refresh ${name}`}
				onClick={() => void refresh(true)}
			/>
		</>
	);
}
const fullResponses: unknown[] = [];
function FullInventory() {
	const { inventory } = useExtensionInventory();
	fullResponses.push(inventory);
	return null;
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}
const inventory = (name: string): McpServersResponse => ({
	settingsPath: "/settings/mcp.json",
	hasSettingsFile: true,
	servers: [{ name, disabled: false, transportType: "stdio", command: "bun" }],
});

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	invalidateExtensionInventoryCache();
	invoke.mockReset();
	fullResponses.length = 0;
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	invalidateExtensionInventoryCache();
});

it("shares one read, status, and committed response across headless consumers", async () => {
	const pending = deferred<McpServersResponse>();
	invoke.mockReturnValue(pending.promise);
	await act(async () =>
		root.render(
			<>
				<Inventory name="first" />
				<Inventory name="second" />
			</>,
		),
	);
	expect(invoke).toHaveBeenCalledExactlyOnceWith("list_mcp_servers");
	expect(container.textContent).toBe("LoadingLoading");
	await act(async () => pending.resolve(inventory("initial")));
	expect(container.textContent).toBe("initialinitial");
	await act(async () => {
		commitMcpServersResponse(inventory("committed"));
	});
	expect(container.textContent).toBe("committedcommitted");
	expect(invoke).toHaveBeenCalledOnce();
});

it("publishes dedicated MCP reads even when the full inventory retains its identity", async () => {
	const full = commitExtensionInventoryResponse({ mcp: inventory("outdated") });
	invoke.mockResolvedValueOnce(inventory("current"));
	await act(async () =>
		root.render(
			<>
				<FullInventory />
				<Inventory name="mcp" />
			</>,
		),
	);
	expect(fullResponses.at(-1)).toBe(full);
	expect(container.textContent).toBe("current");
	invoke.mockResolvedValueOnce(inventory("refreshed"));
	await act(async () => {
		container.querySelector<HTMLButtonElement>("button")?.click();
	});
	expect(container.textContent).toBe("refreshed");
	expect(fullResponses.every((value) => value === full)).toBe(true);
	expect(invoke.mock.calls.map(([command]) => command)).toEqual([
		"list_mcp_servers",
		"list_mcp_servers",
	]);
});

it.each([
	"success",
	"failure",
])("keeps a committed mutation when an older MCP read finishes with %s", async (outcome) => {
	const old = deferred<McpServersResponse>();
	invoke.mockReturnValue(old.promise);
	await act(async () => root.render(<Inventory name="mcp" />));
	await act(async () => {
		commitMcpServersResponse(inventory("committed"));
	});
	await act(async () => {
		if (outcome === "success") old.resolve(inventory("obsolete"));
		else old.reject(new Error("obsolete failure"));
	});
	expect(container.textContent).toBe("committed");
});

it("shares dedicated MCP read failures without discarding a previous response", async () => {
	invoke.mockResolvedValueOnce(inventory("cached"));
	await act(async () =>
		root.render(
			<>
				<Inventory name="first" />
				<Inventory name="second" />
			</>,
		),
	);
	invoke.mockRejectedValueOnce(new Error("MCP settings unavailable"));
	await act(async () => {
		container.querySelector<HTMLButtonElement>("button")?.click();
	});
	expect(container.textContent).toBe(
		"cachedError: MCP settings unavailablecachedError: MCP settings unavailable",
	);
});

it("reconciles invalidation while unmounted before publishing the next MCP response", async () => {
	invoke.mockResolvedValueOnce(inventory("old"));
	await act(async () => root.render(<Inventory name="mcp" />));
	await act(async () => root.render(null));
	invalidateExtensionInventoryCache();
	const next = deferred<McpServersResponse>();
	invoke.mockReturnValueOnce(next.promise);
	await act(async () => root.render(<Inventory name="mcp" />));
	expect(container.textContent).toBe("Loading");
	await act(async () => next.resolve(inventory("new")));
	expect(container.textContent).toBe("new");
});
