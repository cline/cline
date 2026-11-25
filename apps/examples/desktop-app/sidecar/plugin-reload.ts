import { formatSessionPluginIssue } from "@cline/core";
import type { SessionPluginIssue } from "@cline/shared";
import { emitChunk, ensureSharedHubClient } from "./context";
import {
	type JsonRecord,
	LOCAL_ENVIRONMENT_ID,
	type SidecarContext,
} from "./types";

// Restarts that load changed plugins, by session. A send that may restart a
// stale chat claims the restart before it expands its prompt, and every other
// send to that chat waits for the claim before it reaches the Hub, so it lands
// in the restarted session instead of the one being replaced.
export const pluginReloads = new Map<string, Promise<void>>();

export function claimPluginReload(sessionId: string): () => void {
	const claim = Promise.withResolvers<void>();
	pluginReloads.set(sessionId, claim.promise);
	return () => {
		if (pluginReloads.get(sessionId) === claim.promise) {
			pluginReloads.delete(sessionId);
		}
		claim.resolve();
	};
}

/**
 * Plugins load once per session start, so open local chats restart before
 * their next turn to pick up a plugin that was added or turned on. Removing
 * or turning one off restarts nothing, as before: each restart leaves the
 * replaced runtime resident in the Hub, and a plugin that is no longer
 * active withdraws its slot state on its own.
 */
export function markLocalSessionsPluginsStale(ctx: SidecarContext): void {
	for (const session of ctx.liveSessions.values()) {
		if (session.environmentId === LOCAL_ENVIRONMENT_ID) {
			session.pluginsStale = true;
		}
	}
}

/**
 * The Hub keeps a plugin whose import failed blocked for its lifetime, so an
 * install asks it to import the plugin again. A Hub that never tried has
 * nothing to clear, and a failed request never fails the install.
 */
export async function reloadInstalledPluginInHub(
	ctx: SidecarContext,
	details: JsonRecord | undefined,
): Promise<void> {
	const entryPaths = Array.isArray(details?.entryPaths)
		? details.entryPaths.filter(
				(entryPath): entryPath is string => typeof entryPath === "string",
			)
		: [];
	for (const entryPath of entryPaths) {
		try {
			const hubClient = await ensureSharedHubClient(ctx);
			await hubClient.command("plugins.reload", { plugin: entryPath });
		} catch (error) {
			ctx.logger?.log("Failed to reload the installed plugin in the hub", {
				entryPath,
				error,
				severity: "warn",
			});
		}
	}
}

export function failedPluginIssues(
	issues: ReadonlyArray<SessionPluginIssue> | undefined,
): SessionPluginIssue[] {
	return (issues ?? []).filter((issue) => issue.state === "failed");
}

/**
 * A rebuild has no start reply to carry plugin warnings, so its load
 * failures go to the chat the way later plugin failures do.
 */
export function emitPluginFailureNotices(
	ctx: SidecarContext,
	sessionId: string,
	issues: ReadonlyArray<SessionPluginIssue> | undefined,
): void {
	for (const issue of failedPluginIssues(issues)) {
		emitChunk(
			ctx,
			sessionId,
			"chat_core_log",
			JSON.stringify({
				level: "warn",
				message: formatSessionPluginIssue(issue),
				noticeType: "status",
				metadata: { pluginIssue: issue },
			}),
		);
	}
}
