import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Connector tools execute through the Cline API connectors proxy, so the
 * extension resolves a Cline account token. Mock the token resolution so
 * tests can drive the signed-in / signed-out cases without a real account.
 */
const auth = vi.hoisted(() => ({
	token: "cline_token_123" as string | undefined,
	baseUrl: "https://api.cline.bot",
}));

vi.mock("../../runtime/orchestration/runtime-oauth-token-manager", () => ({
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
			return { baseUrl: auth.baseUrl };
		}
	},
}));

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
	const settingsDir = join(tempDataDir, "settings");
	mkdirSync(settingsDir, { recursive: true });
	writeFileSync(
		join(settingsDir, "composio.json"),
		JSON.stringify(state, null, "\t"),
	);
}

async function setupTools(): Promise<RegisteredTool[]> {
	const extension = createComposioToolsExtension();
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
	tempDataDir = mkdtempSync(join(tmpdir(), "composio-ext-test-"));
	process.env.CLINE_DATA_DIR = tempDataDir;
	auth.token = "cline_token_123";
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
	it("returns undefined when there is no connector state", async () => {
		expect(createComposioToolsExtension()).toBeUndefined();
	});

	it("returns undefined when every connected toolkit has zero tools", async () => {
		writeState({
			toolkits: { github: { connectedAccountId: "ca_github", tools: [] } },
		});
		expect(createComposioToolsExtension()).toBeUndefined();
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
							inputParameters: {
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
							inputParameters: {
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
			"https://api.cline.bot/v1/connectors/composio/tools/GMAIL_SEND_EMAIL/execute",
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

	it("returns structured errors on HTTP failures instead of throwing", async () => {
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
					new Response(JSON.stringify({ message: "connection expired" }), {
						status: 401,
					}),
			),
		);
		const tools = await setupTools();
		const result = (await tools[0].execute({ title: "bug" })) as {
			successful: boolean;
			error: string;
		};
		expect(result.successful).toBe(false);
		expect(result.error).toContain("HTTP 401");
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
});
