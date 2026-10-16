import {
	type AgentExtensionUiSlot,
	type BasicLogger,
	PLUGIN_UI_LIMITS,
	type PluginUiAction,
	type PluginUiActionContext,
	type PluginUiActionReply,
	type PluginUiInvokeResult,
	type PluginUiSlot,
	readPluginUiSlotCatalog,
} from "@cline/shared";
import { Deadline } from "./session-chain";
import type { PluginUiStore } from "./store";

export type SlotHandler = AgentExtensionUiSlot & { plugin: string };

function toInvokeResult(reply: PluginUiActionReply): PluginUiInvokeResult {
	if (reply?.outcome !== "refused") return { outcome: "ok" };
	return reply.reason === "stale" || reply.reason === "unsendable"
		? { outcome: "refused", reason: reply.reason }
		: { outcome: "refused" };
}

export function knownSlot(value: unknown): PluginUiSlot | undefined {
	return readPluginUiSlotCatalog([value])[0];
}

/** The slot's owner's handler; with no owner yet, the first registered one claims the slot. */
export function resolveSlotHandler(
	store: Pick<PluginUiStore, "owner" | "claim">,
	registered: readonly SlotHandler[],
	sessionId: string,
	slot: PluginUiSlot,
): SlotHandler | undefined {
	const owner = store.owner(sessionId, slot);
	if (owner !== undefined) {
		return registered.find(
			(handler) => handler.plugin === owner && handler.slot === slot,
		);
	}
	const first = registered.find((handler) => handler.slot === slot);
	return first && store.claim(sessionId, slot, first.plugin)
		? first
		: undefined;
}

/** Core's own bound, in every plugin mode; a late result is discarded. */
export async function callSlotHandler(
	handler: SlotHandler,
	action: PluginUiAction,
	context: PluginUiActionContext,
	{
		sessionId,
		logger,
		cancelled,
	}: {
		sessionId: string;
		logger: BasicLogger | undefined;
		cancelled: () => boolean;
	},
): Promise<PluginUiInvokeResult> {
	const bound = new Deadline(PLUGIN_UI_LIMITS.invokeTimeoutMs);
	try {
		const reply = await Promise.race([
			Promise.resolve().then(() => handler.onAction(action, context)),
			bound.reached,
		]);
		return bound.expired ? { outcome: "timeout" } : toInvokeResult(reply);
	} catch (error) {
		// Plugin error text stays in the session's debug log; the host gets a fixed outcome.
		logger?.debug("Plugin UI slot handler failed", {
			sessionId,
			slot: handler.slot,
			plugin: handler.plugin,
			error,
		});
		return { outcome: cancelled() ? "unavailable" : "rejected" };
	} finally {
		bound.cancel();
	}
}
