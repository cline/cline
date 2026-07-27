import { resolveMcpTimeoutSeconds } from "@cline/shared";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

export function resolveMcpRequestTimeoutMs(timeoutSeconds: unknown): number {
	return resolveMcpTimeoutSeconds(timeoutSeconds) * 1000;
}

export function augmentMcpTimeoutError(
	error: unknown,
	serverName: string,
	timeoutMs: number,
): unknown {
	if (!(error instanceof McpError) || error.code !== ErrorCode.RequestTimeout) {
		return error;
	}
	return new McpError(
		error.code,
		`MCP request to "${serverName}" timed out after ${Math.round(timeoutMs / 1000)}s. ` +
			`Increase the "timeout" field (in seconds) for this server in cline_mcp_settings.json.`,
		error.data,
	);
}
