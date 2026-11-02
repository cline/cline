import {
	createHubMcpApi,
	createHubPluginCommandsApi,
	createHubProviderAuthApi,
	createHubProvidersApi,
} from "@cline/core/hub/browser";

/** Domain APIs backed by a test-owned command recorder; no Desktop transport. */
export function mockHubApis(
	invoke: (
		command: string,
		input?: Record<string, unknown>,
	) => Promise<unknown>,
) {
	const client = {
		command: async (
			command: string,
			payload?: Record<string, unknown>,
			_sessionId?: string,
		) => {
			const value = await invoke(command, payload);
			return {
				version: "v1" as const,
				ok: true,
				payload:
					command === "providers.account.action"
						? { result: value }
						: command.startsWith("plugins.commands.")
							? { catalog: value, result: value }
							: (value as Record<string, unknown>),
			};
		},
	};
	return {
		hubProviders: createHubProvidersApi(client),
		hubAccount: createHubProviderAuthApi(client),
		hubMcp: createHubMcpApi(client),
		hubPlugins: () => createHubPluginCommandsApi(client),
	};
}
