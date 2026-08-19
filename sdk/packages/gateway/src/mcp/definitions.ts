/**
 * MCP server definitions (Gateway RFC, Phase 5).
 *
 * The Gateway owns MCP server definitions — including the ones plugins
 * contribute through their root `mcp.json` — and derives a stable
 * `definitionRevision` from the definition content. The revision is part
 * of every pool key, so a definition change can never silently reuse a
 * connection built from the old definition.
 */

import { createHash } from "node:crypto";
import type { LoadedPlugin } from "../plugins/loader";

export interface McpStdioTransportSpec {
	readonly kind: "stdio";
	readonly command: string;
	readonly args?: readonly string[];
	readonly env?: Readonly<Record<string, string>>;
}

export interface McpHttpTransportSpec {
	readonly kind: "http";
	readonly url: string;
}

export type McpTransportSpec = McpStdioTransportSpec | McpHttpTransportSpec;

export interface McpServerDefinition {
	readonly name: string;
	readonly transport: McpTransportSpec;
	/**
	 * Named credential scope this server authenticates under. The scope
	 * NAME participates in pool keys and credential-drain; the secret
	 * itself stays in Gateway-owned 0600 files and is resolved by the
	 * transport factory.
	 */
	readonly authScope?: string;
}

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(",")}]`;
	}
	if (typeof value === "object" && value !== null) {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, entryValue]) => entryValue !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(
				([key, entryValue]) =>
					`${JSON.stringify(key)}:${stableStringify(entryValue)}`,
			);
		return `{${entries.join(",")}}`;
	}
	return JSON.stringify(value);
}

/** Content-derived revision: same definition, same revision — always. */
export function definitionRevision(definition: McpServerDefinition): string {
	return createHash("sha256")
		.update(stableStringify(definition))
		.digest("hex")
		.slice(0, 16);
}

/** Definitions contributed by one loaded plugin's root `mcp.json`. */
export function definitionsFromPlugin(
	plugin: LoadedPlugin,
): McpServerDefinition[] {
	const definitions: McpServerDefinition[] = [];
	for (const server of plugin.mcpServers) {
		if (server.command) {
			definitions.push({
				name: `${plugin.manifest.name}/${server.name}`,
				transport: {
					kind: "stdio",
					command: server.command,
					...(server.args ? { args: server.args } : {}),
					...(server.env ? { env: server.env } : {}),
				},
			});
		} else if (server.url) {
			definitions.push({
				name: `${plugin.manifest.name}/${server.name}`,
				transport: { kind: "http", url: server.url },
			});
		}
	}
	return definitions;
}
