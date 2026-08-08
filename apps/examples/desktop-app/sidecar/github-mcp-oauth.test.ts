import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServerRegistration } from "@cline/core";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_GITHUB_MCP_OAUTH_CALLBACK_PORT,
	GITHUB_MCP_OAUTH_CALLBACK_HOST,
	GITHUB_MCP_OAUTH_CALLBACK_PATH,
	isOfficialGitHubMcpRegistration,
	prepareGitHubMcpOAuthAuthorization,
	resolveGitHubMcpOAuthConfig,
} from "./github-mcp-oauth";

function githubRegistration(
	url = "https://api.githubcopilot.com/mcp/",
): McpServerRegistration {
	return {
		name: "github",
		transport: { type: "streamableHttp", url },
	};
}

async function useSettingsFile(
	server: Record<string, unknown>,
): Promise<{ settingsPath: string; tempRoot: string }> {
	const tempRoot = await mkdtemp(join(tmpdir(), "github-mcp-oauth-"));
	const settingsPath = join(tempRoot, "cline_mcp_settings.json");
	await writeFile(
		settingsPath,
		JSON.stringify({ mcpServers: { github: server } }),
		"utf8",
	);
	return { settingsPath, tempRoot };
}

describe("GitHub MCP OAuth", () => {
	it("resolves the pre-registered client and defaults the callback to 8085", () => {
		expect(
			resolveGitHubMcpOAuthConfig({
				GITHUB_OAUTH_APP_ID: " client-id ",
				GITHUB_OAUTH_APP_SECRETS: " client-secret ",
			}),
		).toEqual({
			clientId: "client-id",
			clientSecret: "client-secret",
			callbackPort: DEFAULT_GITHUB_MCP_OAUTH_CALLBACK_PORT,
		});
	});

	it("rejects missing credentials and invalid callback ports", () => {
		expect(() =>
			resolveGitHubMcpOAuthConfig({
				GITHUB_OAUTH_APP_SECRETS: "secret",
			}),
		).toThrow("GITHUB_OAUTH_APP_ID");
		expect(() =>
			resolveGitHubMcpOAuthConfig({
				GITHUB_OAUTH_APP_ID: "id",
				GITHUB_OAUTH_APP_SECRETS: "secret",
				GITHUB_OAUTH_CALLBACK_PORT: "8085.5",
			}),
		).toThrow("integer between 1 and 65535");
		expect(() =>
			resolveGitHubMcpOAuthConfig({
				GITHUB_OAUTH_APP_ID: "id",
				GITHUB_OAUTH_APP_SECRETS: "secret",
				GITHUB_OAUTH_CALLBACK_PORT: "65536",
			}),
		).toThrow("integer between 1 and 65535");
	});

	it("only recognizes the official streamable HTTP endpoint", () => {
		expect(isOfficialGitHubMcpRegistration(githubRegistration())).toBe(true);
		expect(
			isOfficialGitHubMcpRegistration(
				githubRegistration("https://api.githubcopilot.com/mcp"),
			),
		).toBe(true);
		expect(
			isOfficialGitHubMcpRegistration(
				githubRegistration("https://api.githubcopilot.com/mcp/insiders"),
			),
		).toBe(false);
		expect(
			isOfficialGitHubMcpRegistration({
				name: "github",
				transport: {
					type: "sse",
					url: "https://api.githubcopilot.com/mcp/",
				},
			}),
		).toBe(false);
	});

	it("does not request credentials or mutate non-GitHub registrations", async () => {
		const server = {
			transport: {
				type: "streamableHttp",
				url: "https://example.com/mcp",
			},
		};
		const { settingsPath, tempRoot } = await useSettingsFile(server);
		try {
			expect(
				prepareGitHubMcpOAuthAuthorization({
					registration: githubRegistration("https://example.com/mcp"),
					filePath: settingsPath,
					env: {},
				}),
			).toBeUndefined();
			const written = JSON.parse(await readFile(settingsPath, "utf8"));
			expect(written.mcpServers.github).toEqual(server);
		} finally {
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	it("stores the client, invalidates stale tokens, and fixes the callback", async () => {
		const { settingsPath, tempRoot } = await useSettingsFile({
			transport: {
				type: "streamableHttp",
				url: "https://api.githubcopilot.com/mcp/",
			},
			oauthClient: {
				clientId: "old-id",
				clientSecret: "old-secret",
			},
			oauth: {
				tokens: { access_token: "stale-token" },
			},
		});
		try {
			const overrides = prepareGitHubMcpOAuthAuthorization({
				registration: githubRegistration(),
				filePath: settingsPath,
				env: {
					GITHUB_OAUTH_APP_ID: "new-id",
					GITHUB_OAUTH_APP_SECRETS: "new-secret",
					GITHUB_OAUTH_CALLBACK_PORT: "8085",
				},
			});
			expect(overrides).toEqual({
				callbackHost: GITHUB_MCP_OAUTH_CALLBACK_HOST,
				callbackPath: GITHUB_MCP_OAUTH_CALLBACK_PATH,
				callbackPorts: [8085],
			});

			const written = JSON.parse(await readFile(settingsPath, "utf8"));
			expect(written.mcpServers.github).toMatchObject({
				disabled: true,
				oauthClient: {
					clientId: "new-id",
					clientSecret: "new-secret",
				},
				oauth: { authorizationRequired: true },
			});
			expect(written.mcpServers.github.oauth).not.toHaveProperty("tokens");
		} finally {
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	it("preserves tokens issued to the unchanged configured client", async () => {
		const { settingsPath, tempRoot } = await useSettingsFile({
			transport: {
				type: "streamableHttp",
				url: "https://api.githubcopilot.com/mcp/",
			},
			oauthClient: {
				clientId: "client-id",
				clientSecret: "client-secret",
			},
			oauth: {
				tokens: { access_token: "current-token" },
			},
		});
		try {
			prepareGitHubMcpOAuthAuthorization({
				registration: githubRegistration(),
				filePath: settingsPath,
				env: {
					GITHUB_OAUTH_APP_ID: "client-id",
					GITHUB_OAUTH_APP_SECRETS: "client-secret",
				},
			});

			const written = JSON.parse(await readFile(settingsPath, "utf8"));
			expect(written.mcpServers.github.oauth.tokens.access_token).toBe(
				"current-token",
			);
		} finally {
			await rm(tempRoot, { recursive: true, force: true });
		}
	});
});
