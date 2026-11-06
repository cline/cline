import type {
	HubCommandInput,
	HubCommandOutputMap,
	HubMcpCommandName,
} from "@cline/shared";
import { HubCommandError, type NodeHubClient } from "./index";
/** Uses the registered local Hub, including when Desktop is viewing a remote workspace. */
export function createHubMcpApi(client: Pick<NodeHubClient, "command">) {
	async function command<T extends HubMcpCommandName>(
		name: T,
		input: HubCommandInput<T>,
	): Promise<HubCommandOutputMap[T]> {
		const reply = await client.command(name, { ...input }, undefined, {
			retryAfterDispatch: false,
			timeoutMs: null,
		});
		if (!reply.ok)
			throw new HubCommandError(
				name,
				reply.error?.code,
				reply.error?.message ?? `Hub command failed: ${name}`,
			);
		return reply.payload as unknown as HubCommandOutputMap[T];
	}
	return {
		list: () => command("mcp.servers.list", {}),
		upsert: (input: HubCommandInput<"mcp.servers.upsert">) =>
			command("mcp.servers.upsert", input),
		setDisabled: (name: string, disabled: boolean) =>
			command("mcp.servers.set_disabled", { name, disabled }),
		delete: (name: string) => command("mcp.servers.delete", { name }),
		ensureSettings: () => command("mcp.settings.ensure", {}),
		inspect: (name: string) => command("mcp.servers.inspect", { name }),
		install: (args: string[]) => command("mcp.servers.install", { args }),
	};
}
export type HubMcpApi = ReturnType<typeof createHubMcpApi>;
