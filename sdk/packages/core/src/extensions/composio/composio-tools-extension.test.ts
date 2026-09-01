import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createComposioToolsExtension } from "./composio-tools-extension";

type RegisteredTool = {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	retryable?: boolean;
	execute: (input: unknown, context?: unknown) => Promise<unknown>;
};

const originalDataDir = process.env.CLINE_DATA_DIR;
const originalEnvApiKey = process.env.COMPOSIO_API_KEY;
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
	delete process.env.COMPOSIO_API_KEY;
});

afterEach(() => {
	if (originalDataDir === undefined) {
		delete process.env.CLINE_DATA_DIR;
	} else {
		process.env.CLINE_DATA_DIR = originalDataDir;
	}
	if (originalEnvApiKey === undefined) {
		delete process.env.COMPOSIO_API_KEY;
	} else {
		process.env.COMPOSIO_API_KEY = originalEnvApiKey;
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
			apiKey: "ck_test",
			userId: "u_test",
			toolkits: {
				github: { connectedAccountId: "ca_github", tools: [] },
			},
		});
		expect(createComposioToolsExtension()).toBeUndefined();
	});

	it("registers one snake_case tool per stored schema", async () => {
		writeState({
			apiKey: "ck_test",
			userId: "u_test",
			toolkits: {
				gmail: {
					connectedAccountId: "ca_gmail",
					tools: [
						{
							slug: "GMAIL_SEND_EMAIL",
							description: "Send an email.",
							version: "20250101_00",
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
		const sendEmail = tools.find((tool) => tool.name === "gmail_send_email");
		expect(sendEmail?.description).toContain("Send an email.");
		expect(sendEmail?.inputSchema).toMatchObject({
			type: "object",
			required: ["to"],
		});
		expect(sendEmail?.retryable).toBe(false);
	});

	it("executes tools against the Composio REST API with the pinned version", async () => {
		writeState({
			apiKey: "ck_test",
			userId: "u_test",
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
					JSON.stringify({
						successful: true,
						data: { messageId: "msg_1" },
						error: null,
					}),
					{ status: 200 },
				),
		);
		vi.stubGlobal("fetch", fetchMock);

		const tools = await setupTools();
		const result = await tools[0].execute({
			to: "someone@example.com",
			subject: "hi",
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			{ method: string; headers: Record<string, string>; body: string },
		];
		expect(url).toBe(
			"https://backend.composio.dev/api/v3.1/tools/execute/GMAIL_SEND_EMAIL",
		);
		expect(init.method).toBe("POST");
		expect(init.headers["x-api-key"]).toBe("ck_test");
		expect(JSON.parse(init.body)).toEqual({
			user_id: "u_test",
			arguments: { to: "someone@example.com", subject: "hi" },
			version: "20250101_00",
		});
		expect(result).toEqual({
			successful: true,
			data: { messageId: "msg_1" },
			error: null,
		});
	});

	it("falls back to the host process COMPOSIO_API_KEY when the state file has no key", async () => {
		writeState({
			userId: "u_env",
			toolkits: {
				github: {
					connectedAccountId: "ca_github",
					tools: [{ slug: "GITHUB_CREATE_AN_ISSUE" }],
				},
			},
		});
		process.env.COMPOSIO_API_KEY = "ck_host_env";
		const fetchMock = vi.fn(
			async () =>
				new Response(JSON.stringify({ successful: true, data: {} }), {
					status: 200,
				}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const tools = await setupTools();
		expect(tools).toHaveLength(1);
		await tools[0].execute({ title: "bug" });
		const [, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			{ headers: Record<string, string> },
		];
		expect(init.headers["x-api-key"]).toBe("ck_host_env");
	});

	it("returns structured errors instead of throwing on HTTP failures", async () => {
		writeState({
			apiKey: "ck_test",
			userId: "u_test",
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
					new Response(JSON.stringify({ error: "connection expired" }), {
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
			apiKey: "ck_test",
			userId: "u_test",
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
