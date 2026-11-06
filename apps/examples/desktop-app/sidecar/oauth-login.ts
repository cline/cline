import { createHubProviderAuthApi } from "@cline/core";
import type { HubOAuthLoginResult } from "@cline/shared";
import { ensureSharedHubClient } from "./context";
import type { SidecarContext } from "./types";

// UI lifetime only. The Hub owns OAuth state, callback listeners and persistence.
const controllers = new Map<object, Map<string, AbortController>>();

export async function runProviderOAuthLogin(
	ctx: SidecarContext,
	providerId: string,
	openUrl: (url: string) => void,
	options: { owner: object; onUserCode?: (userCode: string) => void },
): Promise<HubOAuthLoginResult> {
	const pending =
		controllers.get(options.owner) ?? new Map<string, AbortController>();
	controllers.set(options.owner, pending);
	pending.get(providerId)?.abort();
	const controller = new AbortController();
	pending.set(providerId, controller);
	try {
		const api = createHubProviderAuthApi(await ensureSharedHubClient(ctx));
		return await api.login(
			providerId,
			{
				onAuth: ({ url }) => openUrl(url),
				onUserCode: options.onUserCode,
				onPrompt: async ({ defaultValue }) => defaultValue ?? "",
			},
			controller.signal,
		);
	} finally {
		if (pending.get(providerId) === controller) pending.delete(providerId);
		if (!pending.size) controllers.delete(options.owner);
	}
}

export function cancelProviderOAuthLogin(
	providerId: string,
	owner: object,
): boolean {
	const controller = controllers.get(owner)?.get(providerId);
	controller?.abort();
	return Boolean(controller);
}

export function cancelProviderOAuthLoginsForOwner(owner: object): number {
	const pending = controllers.get(owner);
	if (!pending) return 0;
	for (const controller of pending.values()) controller.abort();
	controllers.delete(owner);
	return pending.size;
}
