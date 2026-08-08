import {
	type AuthorizeMcpServerOAuthOptions,
	type McpServerRegistration,
	updateMcpSettingsFileSync,
} from "@cline/core";
import type { JsonRecord } from "./types";

export const GITHUB_MCP_SERVER_NAME = "github";
export const GITHUB_MCP_SERVER_URL = "https://api.githubcopilot.com/mcp/";
export const GITHUB_MCP_OAUTH_CALLBACK_HOST = "127.0.0.1";
export const GITHUB_MCP_OAUTH_CALLBACK_PATH = "/mcp/oauth/callback";
export const DEFAULT_GITHUB_MCP_OAUTH_CALLBACK_PORT = 8085;

const GITHUB_OAUTH_APP_ID_ENV = "GITHUB_OAUTH_APP_ID";
const GITHUB_OAUTH_APP_SECRETS_ENV = "GITHUB_OAUTH_APP_SECRETS";
const GITHUB_OAUTH_CALLBACK_PORT_ENV = "GITHUB_OAUTH_CALLBACK_PORT";

type GitHubMcpOAuthEnvironmentVariable =
	| typeof GITHUB_OAUTH_APP_ID_ENV
	| typeof GITHUB_OAUTH_APP_SECRETS_ENV
	| typeof GITHUB_OAUTH_CALLBACK_PORT_ENV;

export type GitHubMcpOAuthEnvironment = Readonly<
	Partial<Record<GitHubMcpOAuthEnvironmentVariable, string>>
>;

export interface GitHubMcpOAuthConfig {
	clientId: string;
	clientSecret: string;
	callbackPort: number;
}

export type GitHubMcpOAuthAuthorizationOverrides = Pick<
	AuthorizeMcpServerOAuthOptions,
	"callbackHost" | "callbackPath" | "callbackPorts"
>;

function requiredEnvironmentValue(
	env: GitHubMcpOAuthEnvironment,
	name: GitHubMcpOAuthEnvironmentVariable,
): string {
	const value = env[name]?.trim();
	if (!value) {
		throw new Error(
			`GitHub MCP OAuth is not configured. Set ${name} in apps/.env, then rebuild or restart the desktop sidecar.`,
		);
	}
	return value;
}

/**
 * Keep these as direct process.env property reads. Bun's build-time --define
 * replacement does not match dynamic access such as process.env[name], and
 * packaged apps cannot rely on Finder/the Dock to provide runtime variables.
 */
function readDefaultGitHubMcpOAuthEnvironment(): GitHubMcpOAuthEnvironment {
	return {
		GITHUB_OAUTH_APP_ID: process.env.GITHUB_OAUTH_APP_ID,
		GITHUB_OAUTH_APP_SECRETS: process.env.GITHUB_OAUTH_APP_SECRETS,
		GITHUB_OAUTH_CALLBACK_PORT: process.env.GITHUB_OAUTH_CALLBACK_PORT,
	};
}

export function resolveGitHubMcpOAuthConfig(
	env: GitHubMcpOAuthEnvironment = readDefaultGitHubMcpOAuthEnvironment(),
): GitHubMcpOAuthConfig {
	const clientId = requiredEnvironmentValue(env, GITHUB_OAUTH_APP_ID_ENV);
	const clientSecret = requiredEnvironmentValue(
		env,
		GITHUB_OAUTH_APP_SECRETS_ENV,
	);
	const callbackPortText =
		env[GITHUB_OAUTH_CALLBACK_PORT_ENV]?.trim() ||
		String(DEFAULT_GITHUB_MCP_OAUTH_CALLBACK_PORT);
	if (!/^\d+$/.test(callbackPortText)) {
		throw new Error(
			`${GITHUB_OAUTH_CALLBACK_PORT_ENV} must be an integer between 1 and 65535.`,
		);
	}
	const callbackPort = Number(callbackPortText);
	if (callbackPort < 1 || callbackPort > 65_535) {
		throw new Error(
			`${GITHUB_OAUTH_CALLBACK_PORT_ENV} must be an integer between 1 and 65535.`,
		);
	}
	return { clientId, clientSecret, callbackPort };
}

export function isOfficialGitHubMcpRegistration(
	registration: McpServerRegistration,
): boolean {
	if (registration.transport.type !== "streamableHttp") {
		return false;
	}
	try {
		const configured = new URL(registration.transport.url);
		const official = new URL(GITHUB_MCP_SERVER_URL);
		return (
			configured.protocol === official.protocol &&
			configured.hostname === official.hostname &&
			configured.port === official.port &&
			configured.username === "" &&
			configured.password === "" &&
			configured.pathname.replace(/\/+$/, "") ===
				official.pathname.replace(/\/+$/, "") &&
			configured.search === "" &&
			configured.hash === ""
		);
	} catch {
		return false;
	}
}

/**
 * Binds the official GitHub MCP registration to the desktop's pre-registered
 * OAuth app immediately before browser authorization. The client secret never
 * crosses the webview transport. Changing either credential invalidates tokens
 * issued to the previous OAuth client.
 */
export function prepareGitHubMcpOAuthAuthorization(options: {
	registration: McpServerRegistration;
	filePath: string;
	env?: GitHubMcpOAuthEnvironment;
}): GitHubMcpOAuthAuthorizationOverrides | undefined {
	if (!isOfficialGitHubMcpRegistration(options.registration)) {
		return undefined;
	}

	const config = resolveGitHubMcpOAuthConfig(options.env);
	updateMcpSettingsFileSync(options.filePath, (settings) => {
		const serversValue = settings.mcpServers;
		if (
			!serversValue ||
			typeof serversValue !== "object" ||
			Array.isArray(serversValue)
		) {
			throw new Error("MCP settings must contain an mcpServers object.");
		}
		const servers = serversValue as JsonRecord;
		const currentValue = Object.hasOwn(servers, options.registration.name)
			? servers[options.registration.name]
			: undefined;
		if (
			!currentValue ||
			typeof currentValue !== "object" ||
			Array.isArray(currentValue)
		) {
			throw new Error(`Unknown MCP server: ${options.registration.name}`);
		}

		const current = currentValue as JsonRecord;
		const previousClient =
			current.oauthClient &&
			typeof current.oauthClient === "object" &&
			!Array.isArray(current.oauthClient)
				? (current.oauthClient as JsonRecord)
				: undefined;
		const clientChanged =
			previousClient?.clientId !== config.clientId ||
			previousClient?.clientSecret !== config.clientSecret;
		if (clientChanged) {
			delete current.oauth;
		}
		current.oauthClient = {
			clientId: config.clientId,
			clientSecret: config.clientSecret,
		};
		current.disabled = true;

		const oauth =
			current.oauth &&
			typeof current.oauth === "object" &&
			!Array.isArray(current.oauth)
				? (current.oauth as JsonRecord)
				: {};
		const tokens =
			oauth.tokens &&
			typeof oauth.tokens === "object" &&
			!Array.isArray(oauth.tokens)
				? (oauth.tokens as JsonRecord)
				: undefined;
		if (typeof tokens?.access_token !== "string") {
			current.oauth = {
				...oauth,
				authorizationRequired: true,
				lastError: undefined,
			};
		}
	});

	return {
		callbackHost: GITHUB_MCP_OAUTH_CALLBACK_HOST,
		callbackPath: GITHUB_MCP_OAUTH_CALLBACK_PATH,
		callbackPorts: [config.callbackPort],
	};
}
