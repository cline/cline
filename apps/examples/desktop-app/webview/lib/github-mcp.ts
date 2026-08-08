export const GITHUB_MCP_SERVER_NAME = "github";
export const GITHUB_MCP_SERVER_URL = "https://api.githubcopilot.com/mcp/";
export const GITHUB_MCP_MARKETPLACE_ENTRY_KEY = `mcp:${GITHUB_MCP_SERVER_NAME}`;

export function isOfficialGitHubMcpUrl(value: string | undefined): boolean {
	if (!value) {
		return false;
	}
	try {
		const configured = new URL(value);
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
