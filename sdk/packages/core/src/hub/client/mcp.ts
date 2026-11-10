import type {
	HubCommandInput,
	HubCommandOutputMap,
	HubMcpCommandName,
} from "@cline/shared";
import { createSessionId } from "@cline/shared";
import { HubCommandError, type NodeHubClient } from "./index";
/** Uses the registered local Hub, including when Desktop is viewing a remote workspace. */
export function createHubMcpApi(client: Pick<NodeHubClient, "command">) {
	async function command<T extends HubMcpCommandName>(
		name: T,
		input: HubCommandInput<T>,
	): Promise<HubCommandOutputMap[T]> {
		const reply = await client.command(name, { ...input }, undefined, {
			retryAfterDispatch: false,
			// Catalog reads do not enter the mutation/probe queue.
			// Keep their default deadline while allowing queued work to finish.
			timeoutMs: name === "mcp.servers.list" ? undefined : null,
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
		async authorize(
			name: string,
			options: {
				openUrl: (url: string) => void | Promise<void>;
				signal?: AbortSignal;
			},
		) {
			const { signal } = options;
			signal?.throwIfAborted();
			const loginId = createSessionId("mcp_oauth_");
			const cancel = (
				reason: "user" | "disconnected" = signal?.reason === "disconnected"
					? "disconnected"
					: "user",
			) => command("mcp.oauth.cancel", { loginId, reason });
			const abort = () => {
				void cancel().catch(() => undefined);
			};
			signal?.addEventListener("abort", abort, { once: true });
			try {
				await command("mcp.oauth.start", { name, loginId });
				if (signal?.aborted) await cancel();
				for (;;) {
					const snapshot = await command("mcp.oauth.next", { loginId });
					if (snapshot.error) {
						if (snapshot.error.code === "mcp_oauth_cancelled")
							return await command("mcp.servers.list", {});
						throw new HubCommandError(
							"mcp.oauth.start",
							snapshot.error.code,
							snapshot.error.message,
						);
					}
					for (const url of snapshot.urls) {
						if (signal?.aborted) break;
						await options.openUrl(url);
					}
					if (snapshot.result) return await command("mcp.servers.list", {});
				}
			} catch (error) {
				await cancel(
					signal?.aborted && signal.reason !== "disconnected"
						? "user"
						: "disconnected",
				).catch(() => undefined);
				throw error;
			} finally {
				signal?.removeEventListener("abort", abort);
			}
		},
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
