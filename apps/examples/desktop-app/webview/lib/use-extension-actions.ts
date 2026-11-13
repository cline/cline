import { useSyncExternalStore } from "react";
import { desktopClient } from "./desktop-client";
import {
	commitExtensionInventoryResponse,
	getCachedExtensionInventory,
	invalidateExtensionInventoryCache,
	type PluginItem,
	type SkillItem,
	type UserInstructionListsResponse,
} from "./extension-inventory";
import type { MarketplaceEntry } from "./marketplace";
import { updateCachedMarketplaceEntry } from "./marketplace-installed";

type ExtensionAction = "toggle" | "uninstall";
type ExtensionActionState = {
	pending: ExtensionAction | null;
	error: string | null;
};
type ExtensionActionResult =
	| { status: "succeeded" }
	| { status: "failed"; error: string }
	| { status: "busy" };

export function extensionActionKey(type: "skill" | "plugin", path: string) {
	return `${type}:${path}`;
}

let snapshot = new Map<string, ExtensionActionState>();
const listeners = new Set<() => void>();
const getSnapshot = () => snapshot;
function publish(key: string, state?: ExtensionActionState) {
	snapshot = new Map(snapshot);
	if (state) snapshot.set(key, state);
	else snapshot.delete(key);
	for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
		// Keep pending operations alive across navigation, but release settled feedback
		// when no list or detail consumes it anymore.
		if (listeners.size === 0) {
			snapshot = new Map([...snapshot].filter(([, state]) => state.pending));
		}
	};
}

let extensionInventoryMutationQueue = Promise.resolve();
function enqueueExtensionInventoryMutation<T>(
	mutation: () => Promise<T>,
): Promise<T> {
	const result = extensionInventoryMutationQueue.then(mutation);
	extensionInventoryMutationQueue = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
}

async function run(
	key: string,
	action: ExtensionAction,
	mutate: () => Promise<void>,
): Promise<ExtensionActionResult> {
	if (snapshot.get(key)?.pending) return { status: "busy" };
	publish(key, { pending: action, error: null });
	try {
		await mutate();
		publish(key);
		return { status: "succeeded" };
	} catch (cause) {
		const error = cause instanceof Error ? cause.message : String(cause);
		publish(key, listeners.size ? { pending: null, error } : undefined);
		return { status: "failed", error };
	}
}

function toggleSkill(skill: SkillItem) {
	return run(extensionActionKey("skill", skill.path), "toggle", () =>
		enqueueExtensionInventoryMutation(async () => {
			const current =
				getCachedExtensionInventory()?.skills.find(
					(item) => item.path === skill.path,
				) ?? skill;
			const response = await desktopClient.invoke<UserInstructionListsResponse>(
				"set_skill_disabled",
				{ path: current.path, disabled: current.enabled !== false },
			);
			commitExtensionInventoryResponse(response);
		}),
	);
}

function togglePlugin(plugin: PluginItem) {
	return run(extensionActionKey("plugin", plugin.path), "toggle", () =>
		enqueueExtensionInventoryMutation(async () => {
			const current =
				getCachedExtensionInventory()?.plugins.find(
					(item) => item.path === plugin.path,
				) ?? plugin;
			const response = await desktopClient.invoke<UserInstructionListsResponse>(
				"set_plugin_disabled",
				{ path: current.path, disabled: current.enabled },
			);
			commitExtensionInventoryResponse(response);
		}),
	);
}

function uninstallSkill(skill: SkillItem | undefined, entry: MarketplaceEntry) {
	return run(
		extensionActionKey("skill", skill?.path ?? `catalog:${entry.id}`),
		"uninstall",
		async () => {
			if (skill) {
				await desktopClient.invoke("uninstall_local_primitive", {
					type: "skill",
					id: skill.path.replaceAll("\\", "/").toLowerCase(),
					name: skill.name,
					path: skill.path,
				});
			} else {
				await desktopClient.invoke(
					"uninstall_marketplace_entry",
					{ entry },
					{ timeoutMs: 300_000 },
				);
			}
			invalidateExtensionInventoryCache();
			if (!skill) updateCachedMarketplaceEntry(entry, false);
		},
	);
}

function uninstallPlugin(plugin: PluginItem, entries: MarketplaceEntry[]) {
	return run(
		extensionActionKey("plugin", plugin.path),
		"uninstall",
		async () => {
			await desktopClient.invoke("uninstall_local_primitive", {
				type: "plugin",
				id: plugin.name,
				name: plugin.name,
				path: plugin.path,
			});
			invalidateExtensionInventoryCache();
			for (const entry of entries) updateCachedMarketplaceEntry(entry, false);
		},
	);
}

/** A mutation belongs to the installed item, even when its list or detail changes. */
export function useExtensionActions() {
	const actions = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	return {
		actions,
		toggleSkill,
		togglePlugin,
		uninstallSkill,
		uninstallPlugin,
	};
}
