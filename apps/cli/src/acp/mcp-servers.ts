import type { McpServer } from "@agentclientprotocol/sdk";
import type { McpServerRegistration } from "@cline/core";

type NamedValue = { name: string; value: string };

function toRecord(entries: NamedValue[]): Record<string, string> | undefined {
	if (entries.length === 0) {
		return undefined;
	}
	const record: Record<string, string> = {};
	for (const entry of entries) {
		record[entry.name] = entry.value;
	}
	return record;
}

/**
 * Converts the MCP servers an ACP client sends in `session/new` (or
 * `session/load`) into core MCP registrations.
 *
 * ACP transports map onto core transports one to one: `stdio` → `stdio`,
 * `http` → `streamableHttp` and `sse` → `sse`. Headers and env vars arrive as
 * `{ name, value }` lists and become plain records.
 *
 * A duplicated server name keeps the first definition, mirroring how
 * `cline_mcp_settings.json` duplicates are treated: the host owns the order, so
 * the first entry wins and later ones are ignored.
 */
export function toMcpServerRegistrations(
	servers: McpServer[] | undefined,
): McpServerRegistration[] {
	if (!servers?.length) {
		return [];
	}

	const registrations: McpServerRegistration[] = [];
	const seen = new Set<string>();

	for (const server of servers) {
		if (seen.has(server.name)) {
			continue;
		}
		seen.add(server.name);

		// ACP distinguishes transports by an optional `type` field: `http` and
		// `sse` set it explicitly, while stdio is the default transport and
		// omits it (all agents must support stdio).
		if ("type" in server) {
			registrations.push({
				name: server.name,
				transport: {
					type: server.type === "http" ? "streamableHttp" : "sse",
					url: server.url,
					headers: toRecord(server.headers),
				},
			});
			continue;
		}

		registrations.push({
			name: server.name,
			transport: {
				type: "stdio",
				command: server.command,
				args: server.args.length > 0 ? [...server.args] : undefined,
				env: toRecord(server.env),
			},
		});
	}

	return registrations;
}
