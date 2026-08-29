import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const promptMocks = vi.hoisted(() => ({
	confirm: vi.fn(),
	intro: vi.fn(),
	isCancel: vi.fn(() => false),
	outro: vi.fn(),
	password: vi.fn(),
	select: vi.fn(),
	text: vi.fn(),
	log: {
		error: vi.fn(),
		info: vi.fn(),
		message: vi.fn(),
		step: vi.fn(),
		success: vi.fn(),
		warn: vi.fn(),
	},
}));

const oauthMocks = vi.hoisted(() => ({
	authorize: vi.fn(async () => undefined),
}));

vi.mock("@clack/prompts", () => promptMocks);
vi.mock("./oauth", () => ({
	authorizeMcpServerOAuthWithBrowser: oauthMocks.authorize,
}));

import {
	getMcpOAuthRedirectUris,
	parseOAuthAllowedScopes,
	runMcpWizard,
} from "./index";

describe("MCP OAuth editor", () => {
	const originalSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;
	const tempDirs: string[] = [];

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(async () => {
		process.env.CLINE_MCP_SETTINGS_PATH = originalSettingsPath;
		await Promise.all(
			tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
		);
		tempDirs.length = 0;
	});

	async function writeSlackSettings(options?: {
		headers?: Record<string, string>;
	}): Promise<string> {
		const dir = await mkdtemp(join(tmpdir(), "cline-mcp-editor-"));
		tempDirs.push(dir);
		const settingsPath = join(dir, "cline_mcp_settings.json");
		process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
		await writeFile(
			settingsPath,
			JSON.stringify({
				mcpServers: {
					slack: {
						transport: {
							type: "streamableHttp",
							url: "https://mcp.slack.com/mcp",
							headers: options?.headers,
						},
						oauthClient: {
							clientId: "desktop-client",
							clientSecret: "saved-secret",
							allowedScopes: ["search:read.public", "channels:history"],
							loopbackHostname: "localhost",
						},
						oauth: { tokens: { access_token: "saved-token" } },
					},
				},
			}),
		);
		return settingsPath;
	}

	it("retains scope and hostname policy but not a saved secret when the URL changes", async () => {
		const settingsPath = await writeSlackSettings({
			headers: { "X-Tenant": "one" },
		});
		promptMocks.select
			.mockResolvedValueOnce("edit")
			.mockResolvedValueOnce("slack")
			.mockResolvedValueOnce("streamableHttp")
			.mockResolvedValueOnce("oauth")
			.mockResolvedValueOnce("clear")
			.mockResolvedValueOnce("localhost")
			.mockResolvedValueOnce("exit");
		promptMocks.text
			.mockResolvedValueOnce("https://mcp.slack.com/other-mcp")
			.mockResolvedValueOnce("X-Tenant:one")
			.mockResolvedValueOnce("desktop-client")
			.mockResolvedValueOnce("search:read.public channels:history");
		await expect(runMcpWizard()).resolves.toBe(0);

		const parsed = JSON.parse(await readFile(settingsPath, "utf8")) as {
			mcpServers?: {
				slack?: {
					oauth?: unknown;
					oauthClient?: Record<string, unknown>;
					transport?: Record<string, unknown>;
				};
			};
		};
		const slack = parsed.mcpServers?.slack;
		expect(slack?.transport).toEqual({
			type: "streamableHttp",
			url: "https://mcp.slack.com/other-mcp",
			headers: { "X-Tenant": "one" },
		});
		expect(slack?.oauth).toBeUndefined();
		expect(slack?.oauthClient).toEqual({
			clientId: "desktop-client",
			allowedScopes: ["channels:history", "search:read.public"],
			loopbackHostname: "localhost",
		});
		expect(promptMocks.password).not.toHaveBeenCalled();
		const endpointChangeSecretPrompt = promptMocks.select.mock.calls.find(
			([options]) => options.message.startsWith("The endpoint changed"),
		)?.[0];
		expect(endpointChangeSecretPrompt?.options).toEqual([
			{ value: "replace", label: "Replace saved secret" },
			{ value: "clear", label: "Clear saved secret" },
		]);
		expect(oauthMocks.authorize).toHaveBeenCalledWith("slack");
	});

	it("keeps the saved secret across header reordering and applies an explicit hostname change", async () => {
		const settingsPath = await writeSlackSettings({
			headers: { "X-Tenant": "one", "X-Mode": "test" },
		});
		promptMocks.select
			.mockResolvedValueOnce("edit")
			.mockResolvedValueOnce("slack")
			.mockResolvedValueOnce("streamableHttp")
			.mockResolvedValueOnce("oauth")
			.mockResolvedValueOnce("keep")
			.mockResolvedValueOnce("127.0.0.1")
			.mockResolvedValueOnce("exit");
		promptMocks.text
			.mockResolvedValueOnce("https://mcp.slack.com/mcp")
			.mockResolvedValueOnce("X-Mode:test, X-Tenant:one")
			.mockResolvedValueOnce("desktop-client")
			.mockResolvedValueOnce("channels:history search:read.public");

		await expect(runMcpWizard()).resolves.toBe(0);

		const parsed = JSON.parse(await readFile(settingsPath, "utf8")) as {
			mcpServers?: {
				slack?: {
					oauth?: unknown;
					oauthClient?: Record<string, unknown>;
					transport?: Record<string, unknown>;
				};
			};
		};
		const slack = parsed.mcpServers?.slack;
		expect(slack?.transport).toEqual({
			type: "streamableHttp",
			url: "https://mcp.slack.com/mcp",
			headers: { "X-Mode": "test", "X-Tenant": "one" },
		});
		expect(slack?.oauth).toBeUndefined();
		expect(slack?.oauthClient).toEqual({
			clientId: "desktop-client",
			clientSecret: "saved-secret",
			allowedScopes: ["channels:history", "search:read.public"],
			loopbackHostname: "127.0.0.1",
		});
		expect(promptMocks.password).not.toHaveBeenCalled();
		expect(oauthMocks.authorize).toHaveBeenCalledWith("slack");
	});

	it("normalizes valid scopes and rejects duplicate or invalid scope tokens", () => {
		expect(
			parseOAuthAllowedScopes("search:read.public channels:history"),
		).toEqual(["channels:history", "search:read.public"]);
		expect(parseOAuthAllowedScopes("  ")).toBeUndefined();
		expect(() =>
			parseOAuthAllowedScopes("channels:history channels:history"),
		).toThrow(/duplicates/);
		expect(() => parseOAuthAllowedScopes('channels:history bad"scope')).toThrow(
			/RFC 6749/,
		);
		expect(() =>
			parseOAuthAllowedScopes("channels:history bad\\scope"),
		).toThrow(/RFC 6749/);
	});

	it("uses public install policy as OAuth add defaults without prefilling a secret", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cline-mcp-install-defaults-"));
		tempDirs.push(dir);
		const settingsPath = join(dir, "cline_mcp_settings.json");
		process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
		promptMocks.text
			.mockResolvedValueOnce("slack")
			.mockResolvedValueOnce("https://mcp.slack.com/mcp")
			.mockResolvedValueOnce("")
			.mockResolvedValueOnce("public-client")
			.mockResolvedValueOnce("channels:history search:read.public");
		promptMocks.select
			.mockResolvedValueOnce("streamableHttp")
			.mockResolvedValueOnce("oauth")
			.mockResolvedValueOnce("localhost");
		promptMocks.password.mockResolvedValueOnce("");

		await expect(
			runMcpWizard({
				initialAction: "add",
				exitAfterInitialAction: true,
				addDefaults: {
					name: "slack",
					type: "streamableHttp",
					url: "https://mcp.slack.com/mcp",
					oauthClient: {
						clientId: "public-client",
						allowedScopes: ["channels:history", "search:read.public"],
						loopbackHostname: "localhost",
					},
				},
			}),
		).resolves.toBe(0);

		const authPrompt = promptMocks.select.mock.calls.find(
			([options]) => options.message === "Authentication",
		)?.[0];
		expect(authPrompt?.initialValue).toBe("oauth");
		const clientIdPrompt = promptMocks.text.mock.calls.find(([options]) =>
			options.message.startsWith("OAuth client ID"),
		)?.[0];
		expect(clientIdPrompt?.initialValue).toBe("public-client");
		const secretPrompt = promptMocks.password.mock.calls[0]?.[0];
		expect(secretPrompt?.initialValue).toBeUndefined();

		const parsed = JSON.parse(await readFile(settingsPath, "utf8")) as {
			mcpServers: {
				slack: { oauthClient?: Record<string, unknown> };
			};
		};
		expect(parsed.mcpServers.slack.oauthClient).toEqual({
			clientId: "public-client",
			allowedScopes: ["channels:history", "search:read.public"],
			loopbackHostname: "localhost",
		});
		expect(parsed.mcpServers.slack.oauthClient).not.toHaveProperty(
			"clientSecret",
		);
		expect(oauthMocks.authorize).toHaveBeenCalledWith("slack");
	});

	it("lists every exact callback URI for either supported redirect hostname", () => {
		expect(getMcpOAuthRedirectUris("127.0.0.1")).toEqual([
			"http://127.0.0.1:1456/mcp/oauth/callback",
			"http://127.0.0.1:1457/mcp/oauth/callback",
			"http://127.0.0.1:1458/mcp/oauth/callback",
		]);
		expect(getMcpOAuthRedirectUris("localhost")).toEqual([
			"http://localhost:1456/mcp/oauth/callback",
			"http://localhost:1457/mcp/oauth/callback",
			"http://localhost:1458/mcp/oauth/callback",
		]);
	});
});
