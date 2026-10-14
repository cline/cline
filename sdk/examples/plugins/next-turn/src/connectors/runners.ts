import { PINNED_READ_TIMEOUT_MS, PLUGIN_NAME } from "../config";
import type { ToolRunner } from "./pinned";

/**
 * The two ways a pinned read runs, both through the person's own Cline
 * connection and Cline's own code:
 *
 * - **MCP (K3):** the server's registration from Cline's MCP settings, and
 *   Cline's MCP client factory, which reads and refreshes the server's stored
 *   OAuth state under Cline's settings lock. Each read connects, calls one
 *   tool and disconnects, so a stdio server runs only for the read.
 * - **Composio (K2):** Cline's own Composio extension, whose tools carry the
 *   connector proxy call, the cross-process token lock, the beta flag and the
 *   account check. It is not exported at the pin (upstream ask U4); until it
 *   is, the runner says so and Read stays off.
 */

export const COMPOSIO_READ_NEEDS_U4 =
	"Reading through Composio needs Cline to export its connector tools (upstream ask U4)";

function withTimeout<T>(
	work: Promise<T>,
	ms: number,
	what: string,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`${what} took longer than ${ms} ms`)),
			ms,
		);
	});
	return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export type McpClientPort = {
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	callTool(request: {
		name: string;
		arguments?: Record<string, unknown>;
	}): Promise<unknown>;
};

export type McpRunnerDeps = {
	/** The server's registration from Cline's MCP settings, or nothing when it is gone or disabled. */
	registration(serverName: string): Promise<unknown | undefined>;
	client(registration: unknown): Promise<McpClientPort>;
};

export function mcpRunner(
	serverName: string,
	deps: McpRunnerDeps,
	timeoutMs: number = PINNED_READ_TIMEOUT_MS,
): () => Promise<ToolRunner | { reason: string }> {
	return async () => {
		const registration = await deps.registration(serverName);
		if (!registration)
			return {
				reason: `MCP server "${serverName}" is not in Cline's settings, or is disabled`,
			};
		return async (tool, args) => {
			const client = await deps.client(registration);
			try {
				await withTimeout(
					client.connect(),
					timeoutMs,
					`connecting to "${serverName}"`,
				);
				return await withTimeout(
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
			const factory = core.createDefaultMcpServerClientFactory({
				clientName: PLUGIN_NAME,
			});
			return factory(registration as Parameters<typeof factory>[0]);
		},
	};
}

type CapturedTool = {
	name: string;
	execute: (
		input: unknown,
		context: { agentId: string; iteration: number },
	) => unknown;
};
type ExtensionLike = {
	setup?: (
		api: Record<string, unknown>,
		context: Record<string, unknown>,
	) => unknown;
};

/**
 * Cline's Composio tools, collected by running its extension's `setup` with an
 * API that only records tools. `loadCore` is replaced in tests.
 */
export function composioRunner(
	loadCore: () => Promise<Record<string, unknown>> = () =>
		import("@cline/core") as Promise<Record<string, unknown>>,
	timeoutMs: number = PINNED_READ_TIMEOUT_MS,
): () => Promise<ToolRunner | { reason: string }> {
	return async () => {
		const create = (await loadCore()).createComposioToolsExtension;
		if (typeof create !== "function") return { reason: COMPOSIO_READ_NEEDS_U4 };
		const extension = (await create()) as ExtensionLike | undefined;
		if (!extension?.setup)
			return {
				reason:
					"Composio connectors are off for this Cline account, or none is connected",
			};
		const tools = new Map<string, CapturedTool>();
		const ignore = () => undefined;
		await extension.setup(
			{
				registerTool: (tool: CapturedTool) => tools.set(tool.name, tool),
				registerCommand: ignore,
				registerRule: ignore,
				registerMessageBuilder: ignore,
				registerProvider: ignore,
				registerAutomationEventType: ignore,
				registerMcpServer: ignore,
			},
			{},
		);
		return async (tool, args) => {
			const found = tools.get(tool);
			if (!found)
				throw new Error(`Cline has no Composio tool "${tool}" in this account`);
			return withTimeout(
				Promise.resolve(
					found.execute(args, { agentId: PLUGIN_NAME, iteration: 0 }),
				),
				timeoutMs,
				tool,
			);
		};
	};
}
