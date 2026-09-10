import { Llms } from "@cline/core";

export {
	checkLocalCliInstalled,
	type LocalCliStatus,
} from "@cline/core";

export type ProviderLocalCli = Llms.ProviderLocalCli;

/**
 * The CLI a `local-auth` provider borrows credentials from, as declared in
 * the provider catalog. `undefined` for providers that name none — those are
 * connected without a readiness check rather than probing a guessed command.
 */
export function getLocalCliInfo(
	providerId: string,
): ProviderLocalCli | undefined {
	return Llms.resolveProviderLocalCli(providerId);
}
