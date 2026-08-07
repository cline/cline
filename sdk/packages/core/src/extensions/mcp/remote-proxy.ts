import type {
	McpServerTransportConfig,
	McpStdioTransportConfig,
	McpStreamableHttpTransportConfig,
} from "./types";

function executableName(command: string): string {
	return (
		command
			.trim()
			.split(/[\\/]/)
			.at(-1)
			?.toLowerCase()
			.replace(/\.(?:cmd|exe)$/i, "") ?? ""
	);
}

/**
 * Recognizes the exact no-option `npx mcp-remote <url>` proxy shape emitted by
 * older marketplace entries. Cline has a native Streamable HTTP transport, so
 * spawning the proxy would duplicate OAuth handling and let the child process
 * open a browser as a side effect of merely enabling the server.
 */
export function resolveMcpRemoteProxyTransport(
	transport: McpStdioTransportConfig,
): McpStreamableHttpTransportConfig | undefined {
	if (executableName(transport.command) !== "npx") {
		return undefined;
	}
	if (Object.keys(transport.env ?? {}).length > 0) {
		return undefined;
	}
	const args = transport.args ?? [];
	let index = 0;
	while (args[index] === "-y" || args[index] === "--yes") {
		index += 1;
	}
	if (!/^mcp-remote(?:@[^/\s]+)?$/.test(args[index] ?? "")) {
		return undefined;
	}
	const rawUrl = args[index + 1];
	if (!rawUrl || args.length !== index + 2) {
		return undefined;
	}
	try {
		const url = new URL(rawUrl);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return undefined;
		}
		return { type: "streamableHttp", url: url.toString() };
	} catch {
		return undefined;
	}
}

export function resolveNativeMcpTransport(
	transport: McpServerTransportConfig,
): McpServerTransportConfig {
	return transport.type === "stdio"
		? (resolveMcpRemoteProxyTransport(transport) ?? transport)
		: transport;
}
