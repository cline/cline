import { PLUGIN_UI_LIMITS } from "@cline/shared";

export type PluginUiActionHandler = (
	action: unknown,
	context: unknown,
) => unknown | Promise<unknown>;

export interface PluginUiSlotRegistration {
	slot: string;
	onAction: PluginUiActionHandler;
}

export interface PluginUiContext {
	slots: string[];
	update(slot: string, state: unknown): void;
}

function describeSlot(slot: unknown): string {
	return typeof slot === "string" ? slot : typeof slot;
}

/**
 * The slot API one plugin is offered when the session's host renders at least
 * one slot: `registerUiSlot`, and `ctx.ui` whose updates leave the worker as
 * plain JSON of bounded size, only for slots the plugin registered.
 */
export function createPluginUiSlots(args: {
	pluginName: string;
	slots: readonly string[];
	handlers: Map<string, PluginUiActionHandler>;
	contributions: Array<{ id: string; slot: string }>;
	nextContributionId: () => string;
	isDisposing: () => boolean;
	emitLog: (payload: unknown) => void;
	emitUiState: (payload: unknown) => void;
}): {
	registerUiSlot: (registration: PluginUiSlotRegistration) => void;
	ui: PluginUiContext;
} {
	const registeredSlots = new Set<string>();
	const log = (message: string, metadata?: Record<string, unknown>) => {
		try {
			args.emitLog({
				level: "debug",
				pluginName: args.pluginName,
				message,
				metadata,
			});
		} catch {
			// ctx.ui never throws into the plugin, even when the channel is gone.
		}
	};
	const dropUpdate = (
		slot: unknown,
		reason: "disposing" | "unregistered" | "too_large" | "unserializable",
	) =>
		log(`Dropped a UI update for slot "${describeSlot(slot)}": ${reason}`, {
			slot: describeSlot(slot),
			reason,
		});
	return {
		registerUiSlot: (registration) => {
			if (!args.slots.includes(registration.slot)) {
				log(
					`Ignored UI slot "${describeSlot(registration.slot)}": this session's host does not render it`,
				);
				return;
			}
			const id = args.nextContributionId();
			args.handlers.set(id, registration.onAction);
			args.contributions.push({ id, slot: registration.slot });
			registeredSlots.add(registration.slot);
		},
		ui: {
			slots: [...args.slots],
			update: (slot, state) => {
				if (args.isDisposing()) {
					dropUpdate(slot, "disposing");
					return;
				}
				if (!registeredSlots.has(slot)) {
					dropUpdate(slot, "unregistered");
					return;
				}
				let plain: unknown;
				try {
					const json = JSON.stringify(state ?? null);
					if (
						Buffer.byteLength(json, "utf8") > PLUGIN_UI_LIMITS.workerStateBytes
					) {
						dropUpdate(slot, "too_large");
						return;
					}
					plain = JSON.parse(json);
				} catch {
					dropUpdate(slot, "unserializable");
					return;
				}
				try {
					args.emitUiState({
						pluginName: args.pluginName,
						slot,
						state: plain,
					});
				} catch {
					// Fire-and-forget: a closed channel must not throw into the plugin.
				}
			},
		},
	};
}
