import type { McpServerClient, McpServerRegistration } from "@cline/core";
import { PINNED_READ_TIMEOUT_MS, PLUGIN_NAME } from "../config";
import { rejectAfter } from "../deadline";
import { mcpServerLabel } from "./mcp";
import type { ResolveRunner } from "./pinned";

/**
 * A pinned read on an MCP server runs through the person's own Cline
 * connection and Cline's own code: the server's registration from Cline's MCP
 * settings, and Cline's MCP client factory, which reads and refreshes the
 * server's stored OAuth state under Cline's settings lock. Each read connects,
 * calls one tool and disconnects, so a stdio server runs only for the read.
 */

export type McpClientPort = Pick<
	McpServerClient,
	"connect" | "disconnect" | "callTool"
>;

export type McpRunnerDeps = {
	/** The server's registration from Cline's MCP settings, or nothing when it is gone or disabled. */
	registration(serverName: string): Promise<McpServerRegistration | undefined>;
	client(registration: McpServerRegistration): Promise<McpClientPort>;
};

export function mcpRunner(
	serverName: string,
	deps: McpRunnerDeps,
	timeoutMs: number = PINNED_READ_TIMEOUT_MS,
): ResolveRunner {
	return async () => {
		const registration = await deps.registration(serverName);
		if (!registration)
			return {
				reason: `${mcpServerLabel(serverName)} is not in Cline's settings, or is disabled`,
			};
		return async (tool, args) => {
			const client = await deps.client(registration);
			try {
				await rejectAfter(
					client.connect(),
					timeoutMs,
					`connecting to "${serverName}"`,
				);
				return await rejectAfter(
					client.callTool({ name: tool, arguments: args }),
					timeoutMs,
					`${serverName}/${tool}`,
				);
			} finally {
				await client.disconnect().catch(() => undefined);
			}
		};
	};
}

/** Cline's MCP settings and client factory; `@cline/core` is imported on first use. */
export function clineMcpRunnerDeps(): McpRunnerDeps {
	return {
		async registration(serverName) {
			const core = await import("@cline/core");
			const registration = core.resolveMcpServerRegistration(serverName);
			return registration && !registration.disabled ? registration : undefined;
		},
		async client(registration) {
			const core = await import("@cline/core");
			return core.createDefaultMcpServerClientFactory({
				clientName: PLUGIN_NAME,
			})(registration);
		},
	};
}
