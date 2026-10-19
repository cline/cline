import { describe, expect, it, vi } from "vitest";
import { createMcpAppsRuntime } from "./session-apps";
import type { McpToolDescriptor } from "./types";

const weatherTools: McpToolDescriptor[] = [
	{
		name: "show_weather",
		inputSchema: { type: "object" },
		_meta: { ui: { resourceUri: "ui://weather/view.html" } },
	},
	{
		name: "refresh_view",
		inputSchema: { type: "object" },
		_meta: { ui: { visibility: ["app"] } },
	},
	{
		name: "summarize",
		inputSchema: { type: "object" },
		_meta: { ui: { visibility: ["model"] } },
	},
	{ name: "plain", inputSchema: { type: "object" } },
];

function createManager() {
	return {
		listTools: vi.fn(async (serverName: string) => {
			if (serverName === "broken") {
				throw new Error("offline");
			}
			return serverName === "weather" ? weatherTools : [];
		}),
		callTool: vi.fn(async () => ({ content: [] })),
		readResource: vi.fn(async () => ({ contents: [] })),
	};
}

describe("MCP Apps session runtime", () => {
	it("resolves an agent tool name to its server, tool, and UI resource", async () => {
		const apps = createMcpAppsRuntime({
			manager: createManager(),
			serverNames: ["broken", "weather"],
		});

		await expect(apps.resolveTool("weather__show_weather")).resolves.toEqual({
			serverName: "weather",
			toolName: "show_weather",
			resourceUri: "ui://weather/view.html",
		});
		await expect(apps.resolveTool("weather__plain")).resolves.toBeUndefined();
		await expect(apps.resolveTool("unknown__tool")).resolves.toBeUndefined();
	});

	it("resolves only on servers that loaded tools", async () => {
		const manager = createManager();
		const apps = createMcpAppsRuntime({
			manager,
			serverNames: ["broken", "weather"],
			resolvableServerNames: ["weather"],
		});

		await expect(apps.resolveTool("read_file")).resolves.toBeUndefined();
		expect(manager.listTools).toHaveBeenCalledExactlyOnceWith("weather");
		await apps.readResource({
			serverName: "broken",
			uri: "ui://broken/view.html",
		});
		expect(manager.readResource).toHaveBeenCalledOnce();
	});

	it("matches names produced by a custom name transform", async () => {
		const apps = createMcpAppsRuntime({
			manager: createManager(),
			serverNames: ["weather"],
			nameTransform: ({ toolName }) => `custom_${toolName}`,
		});

		await expect(
			apps.resolveTool("custom_show_weather"),
		).resolves.toMatchObject({ toolName: "show_weather" });
	});

	it("calls tools the app is allowed to call", async () => {
		const manager = createManager();
		const apps = createMcpAppsRuntime({ manager, serverNames: ["weather"] });

		await apps.callTool({
			serverName: "weather",
			toolName: "refresh_view",
			arguments: { city: "Lisbon" },
		});
		await apps.callTool({ serverName: "weather", toolName: "plain" });

		expect(manager.callTool).toHaveBeenNthCalledWith(1, {
			serverName: "weather",
			toolName: "refresh_view",
			arguments: { city: "Lisbon" },
		});
		expect(manager.callTool).toHaveBeenCalledTimes(2);
	});

	it("rejects model-only, missing, and out-of-session tools", async () => {
		const manager = createManager();
		const apps = createMcpAppsRuntime({ manager, serverNames: ["weather"] });

		await expect(
			apps.callTool({ serverName: "weather", toolName: "summarize" }),
		).rejects.toThrow("cannot be called by an app");
		await expect(
			apps.callTool({ serverName: "weather", toolName: "missing" }),
		).rejects.toThrow("was not found");
		await expect(
			apps.callTool({ serverName: "other", toolName: "plain" }),
		).rejects.toThrow("is not available in this session");
		expect(manager.callTool).not.toHaveBeenCalled();
	});

	it("rejects tools disabled by the session's tool policies", async () => {
		const manager = createManager();
		const apps = createMcpAppsRuntime({
			manager,
			serverNames: ["weather"],
			isToolEnabled: (agentToolName) =>
				agentToolName !== "weather__refresh_view",
		});

		await expect(
			apps.callTool({ serverName: "weather", toolName: "refresh_view" }),
		).rejects.toThrow("is disabled for this session");
		await apps.callTool({ serverName: "weather", toolName: "plain" });
		expect(manager.callTool).toHaveBeenCalledExactlyOnceWith({
			serverName: "weather",
			toolName: "plain",
			arguments: undefined,
		});
	});

	it("reads resources only from servers in the session", async () => {
		const manager = createManager();
		const apps = createMcpAppsRuntime({ manager, serverNames: ["weather"] });

		await apps.readResource({
			serverName: "weather",
			uri: "ui://weather/view.html",
		});
		await expect(
			apps.readResource({ serverName: "other", uri: "ui://other/view.html" }),
		).rejects.toThrow("is not available in this session");
		await expect(
			apps.readResource({ serverName: "weather", uri: "file:///etc/hosts" }),
		).rejects.toThrow("can only read ui:// resources");

		expect(manager.readResource).toHaveBeenCalledExactlyOnceWith({
			serverName: "weather",
			uri: "ui://weather/view.html",
		});
	});
});
