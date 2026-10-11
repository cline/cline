import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AgentRuntime } from "@cline/agents";
import type { AgentModel, AgentTool, ITelemetryService } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeEventAdapter } from "../../runtime/orchestration/runtime-event-adapter";
import {
	type AgentEventContext,
	handleAgentEvent,
} from "../../services/agent-events";
import { CORE_TELEMETRY_EVENTS } from "../../services/telemetry/core-events";
import type { CoreSessionConfig } from "../../types/config";

// These tests supply a scripted model; no provider gateway is involved.
vi.mock("@cline/llms", () => ({
	createGateway: vi.fn(() => {
		throw new Error("Unexpected provider gateway in scripted-model test");
	}),
	classifyProviderError: vi.fn(),
	isRetryableProviderError: vi.fn(),
}));

/**
 * Connector tools execute through the Cline API connectors proxy, so the
 * extension resolves a Cline account token. Mock the token resolution so
 * tests can drive the signed-in / signed-out cases without a real account.
 */
const beta = vi.hoisted(() => ({ enabled: true }));
vi.mock("../../services/feature-flags/cline-account-feature-flags", () => ({
	isClineAccountFeatureEnabled: async () => beta.enabled,
}));

const auth = vi.hoisted(() => ({
	token: "cline_token_123" as string | undefined,
	accountId: "account-a" as string | undefined,
	baseUrl: "https://api.cline.bot",
}));

vi.mock("../../runtime/orchestration/runtime-oauth-token-manager", () => ({
	OAuthReauthRequiredError: class extends Error {},
	RuntimeOAuthTokenManager: class {
		async resolveProviderApiKey() {
			return auth.token ? { apiKey: auth.token } : null;
		}
	},
}));
vi.mock("../../services/providers/local-provider-service", () => ({
	resolveLocalClineAuthToken: () => auth.token,
}));
vi.mock("../../services/storage/provider-settings-manager", () => ({
	ProviderSettingsManager: class {
		getProviderSettings() {
			return { baseUrl: auth.baseUrl, auth: { accountId: auth.accountId } };
		}
	},
}));

const meta = vi.hoisted(() => ({
	session: undefined as
		| { sessionId: string; tools: Array<Record<string, unknown>> }
		| undefined,
}));
vi.mock("./composio-meta-tools", async (importOriginal) => ({
	...(await importOriginal<typeof import("./composio-meta-tools")>()),
	createComposioMetaToolSession: vi.fn(async () => meta.session),
}));

import { createComposioMetaToolSession } from "./composio-meta-tools";
import {
	createComposioToolsExtension,
	resolveComposioToolsStatePath,
} from "./composio-tools-extension";

type RegisteredTool = {
	name: string;
	resultPolicy?: "cache-oversized";
	description: string;
	inputSchema: Record<string, unknown>;
	retryable?: boolean;
	execute: (input: unknown, context?: unknown) => Promise<unknown>;
};

const originalDataDir = process.env.CLINE_DATA_DIR;
let tempDataDir: string;

function writeState(state: unknown): void {
	const path = resolveComposioToolsStatePath(auth.accountId ?? "account-a");
	const settingsDir = dirname(path);
	mkdirSync(settingsDir, { recursive: true });
	writeFileSync(path, JSON.stringify(state, null, "\t"));
}

async function setupTools(): Promise<RegisteredTool[]> {
	const extension = await createComposioToolsExtension();
	const tools: RegisteredTool[] = [];
	if (!extension) {
		return tools;
	}
	await extension.setup?.(
		{
			registerTool: (tool: unknown) => tools.push(tool as RegisteredTool),
		} as never,
		{} as never,
	);
	return tools;
}

beforeEach(() => {
	beta.enabled = true;
	tempDataDir = mkdtempSync(join(tmpdir(), "composio-ext-test-"));
	process.env.CLINE_DATA_DIR = tempDataDir;
	auth.token = "cline_token_123";
	auth.accountId = "account-a";
	auth.baseUrl = "https://api.cline.bot";
	meta.session = undefined;
});

afterEach(() => {
	if (originalDataDir === undefined) {
		delete process.env.CLINE_DATA_DIR;
	} else {
		process.env.CLINE_DATA_DIR = originalDataDir;
	}
	vi.unstubAllGlobals();
	rmSync(tempDataDir, { recursive: true, force: true });
});

describe("createComposioToolsExtension", () => {
	it("does not register another account's saved tools", async () => {
		writeState({
			toolkits: {
				gmail: {
					connectedAccountId: "a-gmail",
					tools: [{ slug: "GMAIL_SEND_EMAIL" }],
				},
			},
		});
		auth.accountId = "account-b";
		expect(await setupTools()).toEqual([]);
	});

	it("rejects a running session's tools after switching accounts", async () => {
		writeState({
			toolkits: {
				gmail: {
					connectedAccountId: "a-gmail",
					tools: [{ slug: "GMAIL_SEND_EMAIL" }],
				},
			},
		});
		const tools = await setupTools();
		auth.accountId = "account-b";
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		expect(await tools[0].execute({})).toMatchObject({
			successful: false,
			error: expect.stringContaining("account changed"),
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it("returns undefined when there is no connector state", async () => {
		expect(await createComposioToolsExtension()).toBeUndefined();
	});

	it("returns undefined when every connected toolkit has zero tools", async () => {
		writeState({
			toolkits: { github: { connectedAccountId: "ca_github", tools: [] } },
		});
		expect(await createComposioToolsExtension()).toBeUndefined();
	});

	it("does not register saved tools without beta access", async () => {
		writeState({
			toolkits: {
				gmail: {
					connectedAccountId: "ca_gmail",
					tools: [{ slug: "GMAIL_SEND_EMAIL" }],
				},
			},
		});
		beta.enabled = false;
		expect(await setupTools()).toEqual([]);
	});

	it("refuses execution when beta access is removed after registration", async () => {
		writeState({
			toolkits: {
				gmail: {
					connectedAccountId: "ca_gmail",
					tools: [{ slug: "GMAIL_SEND_EMAIL" }],
				},
			},
		});
		const tools = await setupTools();
		beta.enabled = false;
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		expect(await tools[0].execute({})).toEqual({
			successful: false,
			error: "Composio connectors are not enabled for this account.",
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("registers one snake_case tool per stored schema", async () => {
		writeState({
			toolkits: {
				gmail: {
					connectedAccountId: "ca_gmail",
					tools: [
						{
							slug: "GMAIL_SEND_EMAIL",
							description: "Send an email.",
							input_parameters: {
								type: "object",
								properties: { to: { type: "string" } },
								required: ["to"],
							},
						},
						{ slug: "GMAIL_FETCH_EMAILS" },
					],
				},
				github: {
					connectedAccountId: "ca_github",
					tools: [{ slug: "GITHUB_CREATE_AN_ISSUE" }],
				},
			},
		});
		const tools = await setupTools();
		expect(tools.map((tool) => tool.name).sort()).toEqual([
			"github_create_an_issue",
			"gmail_fetch_emails",
			"gmail_send_email",
		]);
		expect(tools.every((tool) => tool.resultPolicy === "cache-oversized")).toBe(
			true,
		);
		expect(tools.find((t) => t.name === "gmail_send_email")?.retryable).toBe(
			false,
		);
	});

	it("skips a tool whose stored schema createTool rejects instead of failing setup", async () => {
		writeState({
			toolkits: {
				github: {
					connectedAccountId: "ca_github",
					tools: [
						{
							slug: "GITHUB_BROKEN_TOOL",
							input_parameters: {
								allOf: [{ type: "string" }, { type: "number" }],
							},
						},
						{ slug: "GITHUB_CREATE_AN_ISSUE" },
					],
				},
			},
		});
		const tools = await setupTools();
		expect(tools.map((tool) => tool.name)).toEqual(["github_create_an_issue"]);
	});

	it("executes tools through the Cline connectors proxy with a Bearer token and pinned version", async () => {
		writeState({
			toolkits: {
				gmail: {
					connectedAccountId: "ca_gmail",
					tools: [{ slug: "GMAIL_SEND_EMAIL", version: "20250101_00" }],
				},
			},
		});
		const fetchMock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({ successful: true, data: { messageId: "msg_1" } }),
					{ status: 200 },
				),
		);
		vi.stubGlobal("fetch", fetchMock);

		const tools = await setupTools();
		const result = await tools[0].execute({ to: "someone@example.com" });

		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			{ method: string; headers: Record<string, string>; body: string },
		];
		expect(url).toBe(
			"https://api.cline.bot/api/v1/connectors/tools/GMAIL_SEND_EMAIL/execute",
		);
		expect(init.method).toBe("POST");
		expect(init.headers.authorization).toBe("Bearer cline_token_123");
		// No Composio key, and no client-supplied user_id — the proxy derives it.
		expect(init.headers["x-api-key"]).toBeUndefined();
		expect(JSON.parse(init.body)).toEqual({
			arguments: { to: "someone@example.com" },
			version: "20250101_00",
		});
		expect(result).toEqual({ successful: true, data: { messageId: "msg_1" } });
	});

	it("returns a structured auth error when there is no signed-in account", async () => {
		writeState({
			toolkits: {
				github: {
					connectedAccountId: "ca_github",
					tools: [{ slug: "GITHUB_CREATE_AN_ISSUE" }],
				},
			},
		});
		auth.token = undefined; // signed out
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const tools = await setupTools();
		const result = (await tools[0].execute({ title: "bug" })) as {
			successful: boolean;
			error: string;
		};
		expect(result.successful).toBe(false);
		expect(result.error).toMatch(/Sign in to your Cline account/);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each([
		401, 403, 502,
	])("returns structured errors on HTTP %i instead of throwing", async (status) => {
		writeState({
			toolkits: {
				github: {
					connectedAccountId: "ca_github",
					tools: [{ slug: "GITHUB_CREATE_AN_ISSUE" }],
				},
			},
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							success: false,
							error: "connector request failed",
						}),
						{
							status,
						},
					),
			),
		);
		const tools = await setupTools();
		const result = (await tools[0].execute({ title: "bug" })) as {
			successful: boolean;
			error: string;
		};
		expect(result.successful).toBe(false);
		expect(result.error).toContain(`HTTP ${status}`);
		expect(result.error).toContain("GITHUB_CREATE_AN_ISSUE");
	});

	it("returns structured errors when the network is unreachable", async () => {
		writeState({
			toolkits: {
				gmail: {
					connectedAccountId: "ca_gmail",
					tools: [{ slug: "GMAIL_FETCH_EMAILS" }],
				},
			},
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("network down");
			}),
		);
		const tools = await setupTools();
		const result = (await tools[0].execute({})) as {
			successful: boolean;
			error: string;
		};
		expect(result.successful).toBe(false);
		expect(result.error).toContain("network down");
	});

	it("registers meta tools even when no toolkit is connected", async () => {
		meta.session = {
			sessionId: "trs_1",
			tools: [
				{ slug: "COMPOSIO_SEARCH_TOOLS" },
				{
					slug: "COMPOSIO_MANAGE_CONNECTIONS",
					description: "First call COMPOSIO_SEARCH_TOOLS for the user's query.",
					input_parameters: {
						type: "object",
						properties: { session_id: { type: "string" } },
					},
				},
				{ slug: "COMPOSIO_WAIT_FOR_CONNECTIONS" },
				{ slug: "COMPOSIO_MULTI_EXECUTE_TOOL" },
			],
		};
		const tools = await setupTools();
		expect(tools.map((tool) => tool.name)).toEqual([
			"composio_search_tools",
			"composio_manage_connections",
			"composio_wait_for_connections",
			"composio_multi_execute_tool",
		]);
		expect(tools[0]?.retryable).toBe(false);
		// Composio's descriptions and schemas, as the session returned them.
		expect(tools[1]?.description).toBe(
			"First call COMPOSIO_SEARCH_TOOLS for the user's query.",
		);
		expect(tools[1]?.inputSchema.properties).toHaveProperty("session_id");
	});

	it("searches, connects, waits, and executes in one session without saved connections", async () => {
		const actual = await vi.importActual<
			typeof import("./composio-meta-tools")
		>("./composio-meta-tools");
		vi.mocked(createComposioMetaToolSession).mockImplementationOnce(
			actual.createComposioMetaToolSession,
		);
		const steps = [
			{
				slug: "COMPOSIO_SEARCH_TOOLS",
				arguments: { queries: [{ use_case: "Send an email" }] },
				data: { tools: [{ tool_slug: "GMAIL_SEND_EMAIL" }], connected: false },
			},
			{
				slug: "COMPOSIO_MANAGE_CONNECTIONS",
				arguments: { toolkits: ["gmail"] },
				data: { redirect_url: "https://connect.example/gmail" },
			},
			{
				slug: "COMPOSIO_WAIT_FOR_CONNECTIONS",
				arguments: { toolkits: ["gmail"] },
				data: { connected: true },
			},
			{
				slug: "COMPOSIO_MULTI_EXECUTE_TOOL",
				arguments: {
					tools: [
						{
							tool_slug: "GMAIL_SEND_EMAIL",
							arguments: { to: "someone@example.com" },
						},
					],
				},
				data: {
					results: [
						{ tool_slug: "GMAIL_SEND_EMAIL", response: { successful: true } },
					],
				},
			},
		];
		const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
			if (url.endsWith("/meta-tools/sessions")) {
				return Response.json({
					success: true,
					data: {
						sessionId: "trs_flow",
						tools: steps.map(({ slug }) => ({
							slug,
							description:
								slug === "COMPOSIO_MANAGE_CONNECTIONS"
									? "First call COMPOSIO_SEARCH_TOOLS for the user's query."
									: slug,
							input_parameters: { type: "object", properties: {} },
						})),
					},
				});
			}
			const step = steps[fetchMock.mock.calls.length - 2];
			return Response.json({ successful: true, data: step.data });
		});
		vi.stubGlobal("fetch", fetchMock);
		const tools = await setupTools();
		expect(tools.map((tool) => tool.name)).toEqual(
			steps.map((step) => step.slug.toLowerCase()),
		);
		let turn = 0;
		const model: AgentModel = {
			async *stream() {
				const step = steps[turn++];
				if (step) {
					yield {
						type: "tool-call-delta",
						toolCallId: `call-${turn}`,
						toolName: step.slug.toLowerCase(),
						inputText: JSON.stringify(step.arguments),
					};
					yield { type: "finish", reason: "tool-calls" };
				} else {
					yield { type: "text-delta", text: "Email sent." };
					yield { type: "finish", reason: "stop" };
				}
			},
		};
		const runtime = new AgentRuntime({ model, tools: tools as AgentTool[] });
		expect((await runtime.run("Send an email using Gmail")).status).toBe(
			"completed",
		);
		expect(fetchMock).toHaveBeenCalledTimes(5);
		expect(fetchMock.mock.calls[0][0]).toBe(
			"https://api.cline.bot/api/v1/connectors/meta-tools/sessions",
		);
		for (const [, init] of fetchMock.mock.calls) {
			expect(init?.method).toBe("POST");
			expect((init?.headers as Record<string, string>).authorization).toBe(
				"Bearer cline_token_123",
			);
		}
		for (const [index, step] of steps.entries()) {
			const [url, init] = fetchMock.mock.calls[index + 1];
			expect(url).toBe(
				`https://api.cline.bot/api/v1/connectors/meta-tools/${step.slug}/execute`,
			);
			expect(JSON.parse(init?.body as string)).toEqual({
				sessionId: "trs_flow",
				arguments: step.arguments,
			});
		}
	});

	it("executes meta tools with the session id through the proxy", async () => {
		meta.session = {
			sessionId: "trs_1",
			tools: [{ slug: "COMPOSIO_MANAGE_CONNECTIONS" }],
		};
		const fetchMock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({ data: { redirect_url: "https://connect" } }),
				),
		);
		vi.stubGlobal("fetch", fetchMock);
		const [tool] = await setupTools();
		const result = await tool?.execute({ toolkits: ["gmail"] });

		expect(result).toEqual({ data: { redirect_url: "https://connect" } });
		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe(
			"https://api.cline.bot/api/v1/connectors/meta-tools/COMPOSIO_MANAGE_CONNECTIONS/execute",
		);
		expect((init.headers as Record<string, string>).authorization).toBe(
			"Bearer cline_token_123",
		);
		expect(JSON.parse(init.body as string)).toEqual({
			sessionId: "trs_1",
			arguments: { toolkits: ["gmail"] },
		});
	});

	it("refuses meta tool execution after switching accounts", async () => {
		meta.session = {
			sessionId: "trs_1",
			tools: [{ slug: "COMPOSIO_MANAGE_CONNECTIONS" }],
		};
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const [tool] = await setupTools();
		auth.accountId = "account-b";
		expect(await tool?.execute({})).toMatchObject({ successful: false });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each([
		"COMPOSIO_MANAGE_CONNECTIONS",
		"COMPOSIO_WAIT_FOR_CONNECTIONS",
	])("records %s usage once through the runtime event pipeline", async (slug) => {
		meta.session = { sessionId: "trs_1", tools: [{ slug }] };
		const fetchMock = vi.fn(async () =>
			Response.json({ successful: true, data: {} }),
		);
		vi.stubGlobal("fetch", fetchMock);
		const tools = await setupTools();
		const toolName = slug.toLowerCase();
		let turn = 0;
		const model: AgentModel = {
			async *stream() {
				if (turn++ === 0) {
					yield {
						type: "tool-call-delta",
						toolCallId: "connect-call",
						toolName,
						inputText: "{}",
					};
					yield { type: "finish", reason: "tool-calls" };
				} else {
					yield { type: "text-delta", text: "Connected." };
					yield { type: "finish", reason: "stop" };
				}
			},
		};
		const capture = vi.fn();
		const telemetry = { capture } as unknown as ITelemetryService;
		const ctx: AgentEventContext = {
			sessionId: "session-connect",
			config: {
				telemetry,
				providerId: "cline",
				modelId: "test-model",
			} as CoreSessionConfig,
			liveSession: undefined,
			usageBySession: new Map(),
			aggregateUsageBySession: new Map(),
			persistMessages: vi.fn(),
			emit: vi.fn(),
		};
		const runtime = new AgentRuntime({ model, tools: tools as AgentTool[] });
		const adapter = new RuntimeEventAdapter();
		runtime.subscribe((event) => {
			for (const translated of adapter.translate(event)) {
				handleAgentEvent(ctx, translated, {
					agentId: runtime.snapshot().agentId,
				});
			}
		});

		expect((await runtime.run("Connect the app")).status).toBe("completed");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const toolUsage = capture.mock.calls.filter(
			([event]) => event.event === CORE_TELEMETRY_EVENTS.TASK.TOOL_USED,
		);
		expect(toolUsage).toEqual([
			[
				expect.objectContaining({
					properties: expect.objectContaining({
						ulid: "session-connect",
						tool: toolName,
						success: true,
						provider: "cline",
						modelId: "test-model",
						agentId: runtime.snapshot().agentId,
					}),
				}),
			],
		]);
	});
});
