import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleCommand } from "./commands";
import type { SidecarContext } from "./types";

const { api, client } = vi.hoisted(() => ({
	client: {},
	api: {
		list: vi.fn(),
		upsert: vi.fn(),
		setDisabled: vi.fn(),
		delete: vi.fn(),
		ensureSettings: vi.fn(),
		inspect: vi.fn(),
	},
}));
vi.mock("@cline/core", async (original) => ({
	...(await original<typeof import("@cline/core")>()),
	createHubMcpApi: (actual: unknown) => {
		expect(actual).toBe(client);
		return api;
	},
}));
vi.mock("./context", async (original) => ({
	...(await original<typeof import("./context")>()),
	ensureSharedHubClient: vi.fn(async () => client),
}));
const ctx = {
	localWorkspaceRoot: "/local",
	remoteEnvironment: { kind: "ssh" },
} as unknown as SidecarContext;
beforeEach(() => {
	vi.clearAllMocks();
});
describe("Desktop MCP Hub adapter", () => {
	it("uses the local hub for listing even while an SSH environment is selected", async () => {
		api.list.mockResolvedValue({ servers: [] });
		expect(await handleCommand(ctx, "list_mcp_servers")).toEqual({
			servers: [],
		});
		expect(api.list).toHaveBeenCalledOnce();
	});
	it("forwards configuration and lifecycle actions", async () => {
		const input = { name: "test", transportType: "stdio", command: "node" };
		await handleCommand(ctx, "upsert_mcp_server", { input });
		expect(api.upsert).toHaveBeenCalledWith(input);
		await handleCommand(ctx, "set_mcp_server_disabled", {
			name: "test",
			disabled: true,
		});
		expect(api.setDisabled).toHaveBeenCalledWith("test", true);
		await handleCommand(ctx, "delete_mcp_server", { name: "test" });
		expect(api.delete).toHaveBeenCalledWith("test");
		api.ensureSettings.mockResolvedValue({
			settingsPath: "/hub/settings.json",
		});
		expect(await handleCommand(ctx, "ensure_mcp_settings_file")).toBe(
			"/hub/settings.json",
		);
	});
	it.each([
		" foo ",
		"constructor",
		"prototype",
		"__proto__",
		"",
	])("passes the exact deletion key %j to the Hub", async (name) => {
		await handleCommand(ctx, "delete_mcp_server", { name });
		expect(api.delete).toHaveBeenCalledWith(name);
	});

	it.each([
		" foo ",
		"constructor",
		"prototype",
		"__proto__",
		"",
	])("passes the exact toggle and inspection key %j to the Hub", async (name) => {
		await handleCommand(ctx, "set_mcp_server_disabled", {
			name,
			disabled: true,
		});
		expect(api.setDisabled).toHaveBeenCalledWith(name, true);
		await handleCommand(ctx, "inspect_mcp_server", { name });
		expect(api.inspect).toHaveBeenCalledWith(name);
	});

	it("propagates hub failures without a local settings fallback", async () => {
		api.upsert.mockRejectedValue(new Error("Hub unavailable"));
		await expect(
			handleCommand(ctx, "upsert_mcp_server", { input: { name: "test" } }),
		).rejects.toThrow("Hub unavailable");
	});
});
