// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	commitMcpServersResponse,
	invalidateExtensionInventoryCache,
	type McpServer,
	type McpServersResponse,
} from "@/lib/extension-inventory";
import { useMcpServers } from "./use-mcp-servers";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke, subscribe: () => () => {} },
}));

const first: McpServer = {
	name: "first",
	transportType: "stdio",
	command: "bun",
	disabled: false,
};
const other: McpServer = { ...first, name: "other" };
const inventory = (servers = [first, other]): McpServersResponse => ({
	settingsPath: "/settings/mcp.json",
	hasSettingsFile: true,
	servers,
});

let root: Root;
let container: HTMLDivElement;
let state: ReturnType<typeof useMcpServers>;
function Harness({
	onState = (next) => {
		state = next;
	},
}: {
	onState?: (next: ReturnType<typeof useMcpServers>) => void;
}) {
	onState(useMcpServers());
	return null;
}

beforeEach(async () => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	invalidateExtensionInventoryCache();
	invoke.mockReset();
	invoke.mockResolvedValue(inventory());
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	await act(async () => root.render(<Harness />));
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

it.each([
	"toggle",
	"save",
	"delete",
	"authorize",
	"cancel",
] as const)("preserves another server's failure when %s succeeds", async (action) => {
	let completeOther!: (response: McpServersResponse) => void;
	invoke.mockReturnValueOnce(
		new Promise((resolve) => {
			completeOther = resolve;
		}),
	);
	let pending!: Promise<void>;
	await act(async () => {
		switch (action) {
			case "toggle":
				pending = state.toggleServer(other, true);
				break;
			case "save":
				pending = state.upsertServer({ ...other, previousName: other.name });
				break;
			case "delete":
				pending = state.deleteServer(other.name);
				break;
			case "authorize":
				pending = state.authorizeOAuth(other.name);
				break;
			case "cancel":
				pending = state.cancelOAuth(other.name);
				break;
		}
	});
	invoke.mockRejectedValueOnce(new Error("First failed"));
	await act(async () => state.toggleServer(first, true));
	expect(state.serverActionErrors.first?.message).toBe("First failed");
	await act(async () => {
		completeOther(inventory(action === "delete" ? [first] : [first, other]));
		await pending;
	});
	expect(state.serverActionErrors.first).toEqual({
		message: "First failed",
		status: "action-failed",
	});
	expect(state.serverActionErrors.other).toBeUndefined();
});

it("preserves errors across shared responses until an explicit refresh succeeds", async () => {
	invoke.mockRejectedValueOnce(new Error("First failed"));
	await act(async () => state.toggleServer(first, true));
	await act(async () => {
		commitMcpServersResponse(inventory([first, { ...other, disabled: true }]));
	});
	expect(state.serverActionErrors.first?.message).toBe("First failed");
	await act(async () => state.refreshServers());
	expect(state.serverActionErrors.first?.message).toBe("First failed");
	invoke.mockRejectedValueOnce(new Error("Refresh failed"));
	await act(async () => state.refreshServers(true));
	expect(state.serverActionErrors.first?.message).toBe("First failed");
	await act(async () => state.refreshServers(true));
	expect(state.serverActionErrors).toEqual({});
});

it("preserves other errors while reloading OAuth state after a failed authorization", async () => {
	invoke.mockRejectedValueOnce(new Error("First failed"));
	await act(async () => state.toggleServer(first, true));
	invoke.mockRejectedValueOnce(new Error("Authorization failed"));
	await act(async () => state.authorizeOAuth(other.name));
	expect(state.serverActionErrors.first?.message).toBe("First failed");
	expect(state.serverActionErrors.other).toEqual({
		message: "Authorization failed",
		status: "connection-error",
	});
	expect(invoke).toHaveBeenLastCalledWith("list_mcp_servers");
});

it.each([
	false,
	true,
])("clears only the saved server's errors across list and editor instances (rename: %s)", async (rename) => {
	let editor!: ReturnType<typeof useMcpServers>;
	await act(async () =>
		root.render(
			<>
				<Harness />
				<Harness
					onState={(next) => {
						editor = next;
					}}
				/>
			</>,
		),
	);
	invoke.mockRejectedValueOnce(new Error("First failed in list"));
	await act(async () => state.toggleServer(first, true));
	await act(async () =>
		editor.upsertServer({ ...other, previousName: other.name }),
	);
	expect(state.serverActionErrors.first?.message).toBe("First failed in list");
	invoke.mockRejectedValueOnce(new Error("Other failed in list"));
	await act(async () => state.toggleServer(other, true));
	const savedName = rename ? "renamed" : first.name;
	const saved = { ...first, name: savedName };
	invoke.mockRejectedValueOnce(new Error("First failed in editor"));
	await act(async () => editor.toggleServer(saved, true));
	expect(editor.serverActionErrors[savedName]?.message).toBe(
		"First failed in editor",
	);
	invoke.mockResolvedValueOnce(inventory([saved, other]));
	await act(async () =>
		editor.upsertServer({ ...saved, previousName: first.name }),
	);
	expect(state.serverActionErrors.first).toBeUndefined();
	expect(editor.serverActionErrors[savedName]).toBeUndefined();
	expect(state.serverActionErrors.other?.message).toBe("Other failed in list");

	invoke.mockRejectedValueOnce(new Error("Refresh failed"));
	await act(async () => editor.refreshServers(true));
	expect(state.serverActionErrors.other?.message).toBe("Other failed in list");
	await act(async () => editor.refreshServers(true));
	expect(state.serverActionErrors).toEqual({});
	expect(editor.serverActionErrors).toEqual({});
});
