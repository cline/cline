import { createHubMcpApi } from "@cline/core";
import { ensureSharedHubClient } from "./context";
import type { SidecarContext } from "./types";

// UI lifetimes only. The Hub owns authorization, callbacks and credentials.
const pending = new Map<object, Map<string, AbortController>>();
export async function runMcpOAuthAuthorization(
	ctx: SidecarContext,
	name: string,
	owner: object,
	openUrl: (url: string) => Promise<void>,
) {
	const entries = pending.get(owner) ?? new Map<string, AbortController>();
	pending.set(owner, entries);
	entries.get(name)?.abort("disconnected");
	const controller = new AbortController();
	entries.set(name, controller);
	try {
		return await createHubMcpApi(await ensureSharedHubClient(ctx)).authorize(
			name,
			{ openUrl, signal: controller.signal },
		);
	} finally {
		if (entries.get(name) === controller) entries.delete(name);
		if (!entries.size) pending.delete(owner);
	}
}
export function cancelMcpOAuthAuthorization(name: string, owner: object) {
	const controller = pending.get(owner)?.get(name);
	controller?.abort("user");
	return Boolean(controller);
}
export function cancelMcpOAuthAuthorizationsForOwner(owner: object) {
	const entries = pending.get(owner);
	if (!entries) return 0;
	for (const controller of entries.values()) controller.abort("disconnected");
	pending.delete(owner);
	return entries.size;
}
