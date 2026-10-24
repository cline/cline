import type { HubCommandEnvelope } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	SESSION_NOT_FOUND_ERROR_CODE,
	SessionNotFoundError,
} from "../../../runtime/host/runtime-host";
import { buildHubEvent, type HubTransportContext } from "./context";
import {
	handleSessionMcpAppsCallTool,
	handleSessionMcpAppsReadResource,
	handleSessionMcpAppsResolveTool,
} from "./mcp-apps-handlers";

function createContext(
	sessionHost: Partial<HubTransportContext["sessionHost"]>,
): HubTransportContext {
	return {
		sessionSearch: { removeSession: vi.fn() } as never,
		clients: new Map(),
		sessionState: new Map(),
		pendingApprovals: new Map(),
		pendingCapabilityRequests: new Map(),
		suppressNextTerminalEventBySession: new Map(),
		activeRpcTurnCountBySession: new Map(),
		sessionHost: sessionHost as HubTransportContext["sessionHost"],
		publish: vi.fn(),
		buildEvent: buildHubEvent,
		requestCapability: vi.fn(),
	};
}

function envelope(
	command: HubCommandEnvelope["command"],
	payload: Record<string, unknown>,
): HubCommandEnvelope {
	return { version: "v1", command, requestId: "req-1", payload };
}

describe("MCP Apps hub handlers", () => {
	it("resolves an app tool binding", async () => {
		const binding = {
			serverName: "weather",
			toolName: "show_weather",
			resourceUri: "ui://weather/view.html",
		};
		const resolveMcpAppTool = vi.fn().mockResolvedValue(binding);
		const ctx = createContext({ resolveMcpAppTool });

		await expect(
			handleSessionMcpAppsResolveTool(
				ctx,
				envelope("session.mcp_apps.resolve_tool", {
					sessionId: "sess-1",
					toolName: "weather__show_weather",
				}),
			),
		).resolves.toMatchObject({ ok: true, payload: { binding } });
		expect(resolveMcpAppTool).toHaveBeenCalledWith(
			"sess-1",
			"weather__show_weather",
		);
	});

	it("replies without a binding for tools that have no app", async () => {
		const ctx = createContext({
			resolveMcpAppTool: vi.fn().mockResolvedValue(undefined),
		});

		await expect(
			handleSessionMcpAppsResolveTool(
				ctx,
				envelope("session.mcp_apps.resolve_tool", {
					sessionId: "sess-1",
					toolName: "read_file",
				}),
			),
		).resolves.toMatchObject({ ok: true, payload: {} });
	});

	it("forwards resource reads and tool calls", async () => {
		const readMcpAppResource = vi
			.fn()
			.mockResolvedValue({ contents: [{ uri: "ui://weather/view.html" }] });
		const callMcpAppTool = vi.fn().mockResolvedValue({ content: [] });
		const ctx = createContext({ readMcpAppResource, callMcpAppTool });

		await expect(
			handleSessionMcpAppsReadResource(
				ctx,
				envelope("session.mcp_apps.read_resource", {
					sessionId: "sess-1",
					serverName: "weather",
					uri: "ui://weather/view.html",
				}),
			),
		).resolves.toMatchObject({
			ok: true,
			payload: { result: { contents: [{ uri: "ui://weather/view.html" }] } },
		});
		await expect(
			handleSessionMcpAppsCallTool(
				ctx,
				envelope("session.mcp_apps.call_tool", {
					sessionId: "sess-1",
					serverName: "weather",
					toolName: "refresh_view",
					arguments: { city: "Lisbon" },
				}),
			),
		).resolves.toMatchObject({
			ok: true,
			payload: { result: { content: [] } },
		});

		expect(readMcpAppResource).toHaveBeenCalledWith("sess-1", {
			serverName: "weather",
			uri: "ui://weather/view.html",
		});
		expect(callMcpAppTool).toHaveBeenCalledWith("sess-1", {
			serverName: "weather",
			toolName: "refresh_view",
			arguments: { city: "Lisbon" },
		});
	});

	it("rejects missing fields and non-object arguments", async () => {
		const callMcpAppTool = vi.fn();
		const ctx = createContext({ callMcpAppTool });

		await expect(
			handleSessionMcpAppsReadResource(
				ctx,
				envelope("session.mcp_apps.read_resource", {
					sessionId: "sess-1",
					serverName: "weather",
				}),
			),
		).resolves.toMatchObject({
			ok: false,
			error: { code: "invalid_mcp_apps_read_resource" },
		});
		await expect(
			handleSessionMcpAppsCallTool(
				ctx,
				envelope("session.mcp_apps.call_tool", {
					sessionId: "sess-1",
					serverName: "weather",
					toolName: "refresh_view",
					arguments: ["Lisbon"],
				}),
			),
		).resolves.toMatchObject({
			ok: false,
			error: { code: "invalid_mcp_apps_call_tool" },
		});
		expect(callMcpAppTool).not.toHaveBeenCalled();
	});

	it("reports runtime failures as error replies", async () => {
		const ctx = createContext({
			callMcpAppTool: vi
				.fn()
				.mockRejectedValue(new Error("cannot be called by an app")),
			readMcpAppResource: vi
				.fn()
				.mockRejectedValue(new SessionNotFoundError("sess-1")),
		});

		await expect(
			handleSessionMcpAppsCallTool(
				ctx,
				envelope("session.mcp_apps.call_tool", {
					sessionId: "sess-1",
					serverName: "weather",
					toolName: "summarize",
				}),
			),
		).resolves.toMatchObject({
			ok: false,
			error: {
				code: "mcp_apps_call_tool_failed",
				message: "cannot be called by an app",
			},
		});
		await expect(
			handleSessionMcpAppsReadResource(
				ctx,
				envelope("session.mcp_apps.read_resource", {
					sessionId: "sess-1",
					serverName: "weather",
					uri: "ui://weather/view.html",
				}),
			),
		).resolves.toMatchObject({
			ok: false,
			error: { code: SESSION_NOT_FOUND_ERROR_CODE },
		});
	});

	it("reports unsupported runtimes", async () => {
		await expect(
			handleSessionMcpAppsResolveTool(
				createContext({}),
				envelope("session.mcp_apps.resolve_tool", {
					sessionId: "sess-1",
					toolName: "weather__show_weather",
				}),
			),
		).resolves.toMatchObject({ ok: true, payload: {} });
		await expect(
			handleSessionMcpAppsReadResource(
				createContext({}),
				envelope("session.mcp_apps.read_resource", {
					sessionId: "sess-1",
					serverName: "weather",
					uri: "ui://weather/view.html",
				}),
			),
		).resolves.toMatchObject({
			ok: false,
			error: { code: "unsupported_command" },
		});
	});
});
