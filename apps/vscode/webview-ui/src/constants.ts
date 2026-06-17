import { Environment } from "../../src/shared/config-types"

export const LINKS = {
	DOCUMENTATION: {
		REMOTE_MCP_SERVER_DOCS: "https://docs.cline.bot/mcp/connecting-to-a-remote-server",
		LOCAL_MCP_SERVER_DOCS: "https://docs.cline.bot/mcp/configuring-mcp-servers#editing-mcp-settings-files",
	},
}

export const APP_BASE_URL = "https://app.cline.bot"

// Keep in sync with ClineEndpoint.getEnvironment() in apps/vscode/src/config.ts.
const APP_BASE_URL_BY_ENVIRONMENT: Record<Environment, string> = {
	[Environment.production]: APP_BASE_URL,
	[Environment.staging]: "https://staging-app.cline.bot",
	[Environment.local]: "http://localhost:3000",
	[Environment.selfHosted]: APP_BASE_URL,
}

export function getAppBaseUrl(environment?: Environment): string {
	return (environment && APP_BASE_URL_BY_ENVIRONMENT[environment]) || APP_BASE_URL
}
