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
	forbidLocal: false,
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
			if (auth.forbidLocal)
				throw new Error("Unexpected local connector credentials");
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
	resolveComposioConnectionStatePath,
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
	const path = resolveComposioConnectionStatePath(
		auth.accountId ?? "account-a",
	);
	const settingsDir = dirname(path);
	mkdirSync(settingsDir, { recursive: true });
	writeFileSync(path, JSON.stringify(state, null, "\t"));
}

async function setupTools(
	options?: Parameters<typeof createComposioToolsExtension>[0],
): Promise<RegisteredTool[]> {
	const extension = await createComposioToolsExtension(options);
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
	auth.forbidLocal = false;
	meta.session = {
		sessionId: "trs_1",
		tools: [
			{ slug: "COMPOSIO_SEARCH_TOOLS" },
			{ slug: "COMPOSIO_MANAGE_CONNECTIONS" },
			{ slug: "COMPOSIO_WAIT_FOR_CONNECTIONS" },
			{ slug: "COMPOSIO_MULTI_EXECUTE_TOOL" },
		],
	};
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
	it("includes only meta schemas in every model request despite hundreds of saved tools", async () => {
		writeState({
			toolkits: {
				gmail: {
					connectedAccountId: "ca_gmail",
					tools: Array.from({ length: 500 }, (_, i) => ({
						slug: `GMAIL_TOOL_${i}`,
						input_parameters: { type: "object", properties: {} },
					})),
				},
			},
		});
		const tools = await setupTools();
		const expectedNames = meta.session?.tools.map((tool) =>
			String(tool.slug).toLowerCase(),
		);
		let requests = 0;
		vi.stubGlobal("fetch", async () =>
			Response.json({
				successful: true,
				data: {
					tools: [
						{
							slug: "GMAIL_TOOL_1",
							input_parameters: { type: "object", properties: {} },
						},
					],
				},
			}),
		);
		const model: AgentModel = {
			async *stream(request) {
				expect(request.tools.map((tool) => tool.name)).toEqual(expectedNames);
				if (requests++ === 0) {
					yield {
						type: "tool-call-delta",
						toolCallId: "search",
						toolName: "composio_search_tools",
						inputText: "{}",
					};
					yield { type: "finish", reason: "tool-calls" };
				} else {
					yield { type: "text-delta", text: "Found the tool." };
					yield { type: "finish", reason: "stop" };
				}
			},
		};
		expect(
			(
				await new AgentRuntime({ model, tools: tools as AgentTool[] }).run(
					"Find Gmail tools",
				)
			).status,
		).toBe("completed");
		expect(requests).toBe(2);
	});

	it("does not fall back to saved schemas when meta-session creation fails", async () => {
		writeState({
			toolkits: {
				gmail: {
					connectedAccountId: "ca_gmail",
					tools: [{ slug: "GMAIL_SEND_EMAIL" }],
				},
			},
		});
		meta.session = undefined;
		expect(await setupTools()).toEqual([]);
	});

	it("rejects the whole meta-tool flow when a schema cannot be registered", async () => {
		meta.session = {
			sessionId: "trs_1",
			tools: [
				{ slug: "COMPOSIO_MANAGE_CONNECTIONS" },
				{
					slug: "COMPOSIO_SEARCH_TOOLS",
					input_parameters: { allOf: [{ type: "string" }, { type: "number" }] },
				},
			],
		};
		expect(await setupTools()).toEqual([]);
	});

	it("does not register meta tools without beta access or a signed-in account", async () => {
		beta.enabled = false;
		expect(await setupTools()).toEqual([]);
		beta.enabled = true;
		auth.accountId = undefined;
		expect(await setupTools()).toEqual([]);
	});

	it("rechecks beta access and credentials before execution", async () => {
		const [tool] = await setupTools();
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		beta.enabled = false;
		expect(await tool.execute({})).toMatchObject({
			successful: false,
			error: expect.stringContaining("not enabled"),
		});
		beta.enabled = true;
		auth.token = undefined;
		expect(await tool.execute({})).toMatchObject({
			successful: false,
			error: expect.stringContaining("Sign in"),
		});
		expect(fetchMock).not.toHaveBeenCalled();
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

	it.each([
		false,
		true,
	])("runs the in-chat connector flow (host transport: %s)", async (hostTransport) => {
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
		if (hostTransport) {
			beta.enabled = false;
			writeState({
				toolkits: {
					gmail: {
						connectedAccountId: "local",
						tools: [{ slug: "LOCAL_ONLY_TOOL" }],
					},
				},
			});
			auth.forbidLocal = true;
		}
		const tools = await setupTools(
			hostTransport
				? {
						request: (path, init) => fetch(`https://host.example${path}`, init),
					}
				: undefined,
		);
		if (hostTransport) auth.accountId = "account-b";
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
		const origin = hostTransport
			? "https://host.example"
			: "https://api.cline.bot";
		expect(fetchMock.mock.calls[0][0]).toBe(
			`${origin}/api/v1/connectors/meta-tools/sessions`,
		);
		for (const [, init] of fetchMock.mock.calls) {
			expect(init?.method).toBe("POST");
			expect(new Headers(init?.headers).get("authorization")).toBe(
				hostTransport ? null : "Bearer cline_token_123",
			);
		}
		for (const [index, step] of steps.entries()) {
			const [url, init] = fetchMock.mock.calls[index + 1];
			expect(url).toBe(
				`${origin}/api/v1/connectors/meta-tools/${step.slug}/execute`,
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
		expect(new Headers(init.headers).get("authorization")).toBe(
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
