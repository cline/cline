import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type ConnectorsRequest,
	listConnections,
	listToolkitTools,
} from "../../services/connectors/cline-connectors-api";

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
vi.mock("../../services/storage/provider-settings-manager", () => ({
	ProviderSettingsManager: class {
		getProviderSettings() {
			return { baseUrl: auth.baseUrl, auth: { accountId: auth.accountId } };
		}
	},
}));

import { resolveComposioToolsStatePath } from "../../services/connectors/composio-tools";
import { createComposioToolsExtension } from "./composio-tools-extension";

type RegisteredTool = {
	name: string;
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
		expect(result.error).toBe("Cline API request failed: network down");
	});
});

describe("host-supplied Composio tools", () => {
	beforeEach(() => {
		auth.accountId = undefined;
		auth.token = undefined;
		beta.enabled = false;
	});

	it("uses the existing API lists to register and execute without a local login or state file", async () => {
		const schema = {
			slug: "GMAIL_FETCH_EMAILS",
			version: "20250101_00",
			input_parameters: {
				type: "object",
				properties: { limit: { type: "number" } },
			},
		};
		const connection = {
			id: "c1",
			toolkit: { slug: "gmail" },
			status: "ACTIVE",
		};
		const page = (items: unknown[]) =>
			Response.json({ success: true, data: { items, nextToken: "" } });
		const request = vi
			.fn<ConnectorsRequest>()
			.mockResolvedValueOnce(page([connection]))
			.mockResolvedValueOnce(page([schema]))
			.mockResolvedValueOnce(
				Response.json({ successful: true, data: { messages: [] } }),
			);
		const globalFetch = vi.fn();
		vi.stubGlobal("fetch", globalFetch);
		const ctx = { request };
		const [connected] = await listConnections(ctx);
		const toolkits = {
			[connected.toolkit.slug]: await listToolkitTools(
				connected.toolkit.slug,
				ctx,
			),
		};
		const tools = await setupTools({ toolkits, request });
		expect(tools.map((tool) => tool.name)).toEqual(["gmail_fetch_emails"]);
		expect(tools[0].retryable).toBe(false);
		expect(tools[0].inputSchema).toEqual(schema.input_parameters);
		expect(await tools[0].execute({ limit: 1 })).toEqual({
			successful: true,
			data: { messages: [] },
		});
		expect(request).toHaveBeenCalledTimes(3);
		expect(JSON.parse(request.mock.calls[2][1].body as string)).toEqual({
			arguments: { limit: 1 },
			version: "20250101_00",
		});
		expect(globalFetch).not.toHaveBeenCalled();
	});

	it.each([
		1024, 1025, 1026,
	])("normalizes a supplied description of %i characters like local connections", async (length) => {
		const description = "x".repeat(length);
		const request = vi.fn<ConnectorsRequest>();
		const tools = await setupTools({
			request,
			toolkits: {
				gmail: [
					{ slug: "GMAIL_FETCH_EMAILS", description: `  ${description}  ` },
				],
			},
		});
		const normalized =
			length > 1024 ? `${description.slice(0, 1024)}…` : description;
		expect(tools[0].description).toBe(
			`${normalized} (gmail account connected via Composio)`,
		);
	});

	it("normalizes supplied versions, names and primitive input parameters like local connections", async () => {
		const request = vi
			.fn<ConnectorsRequest>()
			.mockResolvedValue(Response.json({ successful: true }));
		const tools = await setupTools({
			request,
			toolkits: {
				gmail: [
					{
						slug: "GMAIL_FETCH_EMAILS",
						name: "  Read mail  ",
						description: "  ",
						version: "  v1  ",
						input_parameters: "invalid",
					},
				],
			},
		});
		expect(tools[0].description).toBe(
			"Read mail (gmail account connected via Composio)",
		);
		expect(tools[0].inputSchema).toEqual({ type: "object", properties: {} });
		await tools[0].execute({});
		expect(JSON.parse(request.mock.calls[0][1].body as string)).toEqual({
			arguments: {},
			version: "v1",
		});
	});

	it("keeps a snapshot and uses the supplied transport even if a desktop user signs in", async () => {
		const request = vi
			.fn<ConnectorsRequest>()
			.mockResolvedValue(Response.json({ successful: true }));
		const toolkits = { gmail: [{ slug: "GMAIL_FETCH_EMAILS", version: "v1" }] };
		const tools = await setupTools({ toolkits, request });
		toolkits.gmail[0].version = "v2";
		auth.accountId = "some-desktop-user";
		auth.token = "unrelated-token";
		await tools[0].execute({});
		expect(JSON.parse(request.mock.calls[0][1].body as string).version).toBe(
			"v1",
		);
		expect(
			new Headers(request.mock.calls[0][1].headers).has("authorization"),
		).toBe(false);
	});

	it("registers nothing for an empty supplied snapshot", async () => {
		const request = vi.fn<ConnectorsRequest>();
		expect(
			await createComposioToolsExtension({ toolkits: {}, request }),
		).toBeUndefined();
		expect(
			await createComposioToolsExtension({ toolkits: { gmail: [] }, request }),
		).toBeUndefined();
		expect(request).not.toHaveBeenCalled();
	});

	it("preserves deduplication and malformed schema handling for supplied tools", async () => {
		const request = vi.fn<ConnectorsRequest>();
		const tools = await setupTools({
			request,
			toolkits: {
				gmail: [
					{ slug: "READ_MAIL" },
					{
						slug: "BROKEN",
						input_parameters: {
							allOf: [{ type: "string" }, { type: "number" }],
						},
					},
				],
				other: [{ slug: "READ_MAIL" }],
			},
		});
		expect(tools.map((tool) => tool.name)).toEqual(["read_mail"]);
	});

	it("surfaces execution revocation without retrying or changing credentials", async () => {
		const request = vi
			.fn<ConnectorsRequest>()
			.mockResolvedValue(
				Response.json({ error: "connection revoked" }, { status: 403 }),
			);
		const tools = await setupTools({
			request,
			toolkits: { gmail: [{ slug: "GMAIL_FETCH_EMAILS" }] },
		});
		expect(await tools[0].execute({})).toMatchObject({
			successful: false,
			error: expect.stringContaining("connection revoked"),
		});
		expect(request).toHaveBeenCalledOnce();
	});
});
