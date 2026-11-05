import type {
	HubCommandInput,
	HubCommandOutputMap,
	HubSkillCommandName,
} from "@cline/shared";
import { type HubCommandClient, HubCommandError } from "./command-client";

/** Skill management always targets the registered local Hub; dispatched mutations are never replayed. */
export function createHubSkillsApi(client: HubCommandClient) {
	async function command<T extends HubSkillCommandName>(
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
		status: (ids: string[]) => command("skills.marketplace.status", { ids }),
		install: (id: string) => command("skills.marketplace.install", { id }),
		uninstall: (id: string) => command("skills.marketplace.uninstall", { id }),
		remove: (input: HubCommandInput<"skills.remove">) =>
			command("skills.remove", input),
	};
}
