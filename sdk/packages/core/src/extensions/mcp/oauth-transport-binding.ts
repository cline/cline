import { createHash } from "node:crypto";
import type { McpServerTransportConfig } from "./types";

export const MCP_OAUTH_TRANSPORT_BINDING_PATTERN = /^sha256:[a-f\d]{64}$/;

type RemoteMcpTransport = Exclude<McpServerTransportConfig, { type: "stdio" }>;

function compareCanonicalHeader(
	left: readonly [string, string],
	right: readonly [string, string],
): number {
	if (left[0] !== right[0]) {
		return left[0] < right[0] ? -1 : 1;
	}
	if (left[1] === right[1]) {
		return 0;
	}
	return left[1] < right[1] ? -1 : 1;
}

/**
 * Binds persisted OAuth material to the exact remote transport that may use
 * it. Header names are case-insensitive and object order is not semantic;
 * duplicate case-insensitive names are rejected because their HTTP merge order
 * is ambiguous. Values and URL strings remain exact. Omitted and empty header
 * maps both represent no headers. Only the digest is persisted, never raw
 * header data.
 */
export function createMcpOAuthTransportBinding(
	transport: RemoteMcpTransport,
): string {
	const canonicalHeaderNames = new Set<string>();
	const headers = Object.entries(transport.headers ?? {}).map(
		([name, value]) => {
			const canonicalName = name.toLowerCase();
			if (canonicalHeaderNames.has(canonicalName)) {
				throw new Error(
					`MCP OAuth transport header names must be unique case-insensitively: ${name}`,
				);
			}
			canonicalHeaderNames.add(canonicalName);
			return [canonicalName, value] as readonly [string, string];
		},
	);
	headers.sort(compareCanonicalHeader);
	const canonicalIdentity = JSON.stringify([
		"cline-mcp-oauth-transport-v1",
		transport.type,
		transport.url,
		headers,
	]);
	return `sha256:${createHash("sha256").update(canonicalIdentity).digest("hex")}`;
}

export function isMcpOAuthTransportBinding(value: unknown): value is string {
	return (
		typeof value === "string" && MCP_OAUTH_TRANSPORT_BINDING_PATTERN.test(value)
	);
}
