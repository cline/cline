import { Environment } from "../../src/shared/config-types"

export const LINKS = {
	DOCUMENTATION: {
		REMOTE_MCP_SERVER_DOCS: "https://docs.cline.bot/mcp/connecting-to-a-remote-server",
		LOCAL_MCP_SERVER_DOCS: "https://docs.cline.bot/mcp/configuring-mcp-servers#editing-mcp-settings-files",
	},
}

/**
 * Default Cline web app base URL (production).
 * Prefer `getAppBaseUrl(environment)` or the env-aware `clineUser.appBaseUrl` when available.
 */
export const APP_BASE_URL = "https://app.cline.bot"

/**
 * Cline web app base URL per environment. Keep in sync with `ClineEndpoint.getEnvironment()`
 * in apps/vscode/src/config.ts (the extension-side source of truth).
 */
const APP_BASE_URL_BY_ENVIRONMENT: Record<Environment, string> = {
	[Environment.production]: APP_BASE_URL,
	[Environment.staging]: "https://staging-app.cline.bot",
	[Environment.local]: "http://localhost:3000",
	// Self-hosted has no canonical web app; fall back to production.
	[Environment.selfHosted]: APP_BASE_URL,
}

/**
 * Resolves the Cline web app base URL for the given environment, defaulting to production.
 */
export function getAppBaseUrl(environment?: Environment): string {
	return (environment && APP_BASE_URL_BY_ENVIRONMENT[environment]) || APP_BASE_URL
}
