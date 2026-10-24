import type {
	HubCommandInput,
	HubCommandOutputMap,
	HubProviderCommandName,
} from "@cline/shared";
import { HubCommandError, type NodeHubClient } from "./index";

/** Uses the caller's registered local Hub connection; mutations are never retried after dispatch. */
export function createHubProvidersApi(client: Pick<NodeHubClient, "command">) {
	async function command<T extends HubProviderCommandName>(
		name: T,
		input: HubCommandInput<T>,
	): Promise<HubCommandOutputMap[T]> {
		const reply = await client.command(name, { ...input }, undefined, {
			retryAfterDispatch: false,
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
		list: (input: HubCommandInput<"providers.list"> = {}) =>
			command("providers.list", input),
		listModels: (input: HubCommandInput<"providers.models.list">) =>
			command("providers.models.list", input),
		recommendedModels: () => command("providers.models.recommended", {}),
		saveSettings: (input: HubCommandInput<"providers.settings.save">) =>
			command("providers.settings.save", input),
		add: (input: HubCommandInput<"providers.add">) =>
			command("providers.add", input),
		updateModels: (input: HubCommandInput<"providers.models.update">) =>
			command("providers.models.update", input),
	};
}
