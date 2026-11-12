import type {
	PluginSandboxOptions,
	PluginSandboxTransport,
	UiStateEvent,
} from "./plugin-sandbox";

type UiSlotPluginDescriptor = {
	pluginId: string;
	name: string;
	contributions: { uiSlots: ReadonlyArray<{ slot: string }> };
};

type RegisteredPlugin = { name: string; slots: ReadonlySet<string> };

type ReceivedUiState = Omit<UiStateEvent, "pluginName"> & {
	pluginId: string;
};

/**
 * Routes the sandbox's UI state events to `onUiState`. Until `initialize` (or
 * a re-initialize after idle reclaim) returns, it holds the latest state per
 * plugin and slot, with room for every plugin path loading, overridden copies
 * included, in every catalog slot. Then it forwards a state only for a slot
 * the plugin's descriptor registered, under the descriptor's name. A post
 * names its plugin by sandbox id, so a same-named plugin that a later path
 * overrode, whose setup still ran, never publishes. A worker runs one plugin,
 * so a post that names none is that plugin's; the subprocess transport drops
 * it.
 */
export function createUiStateGate(
	transport: PluginSandboxTransport | undefined,
	onUiState: PluginSandboxOptions["onUiState"],
	heldCapacity: number,
) {
	const held = new Map<string, ReceivedUiState>();
	let registered: Map<string, RegisteredPlugin> | undefined;
	let workerPlugin: RegisteredPlugin | undefined;
	let openedWith: UiSlotPluginDescriptor[] = [];

	const deliver = (event: ReceivedUiState) => {
		const plugin = event.pluginId
			? registered?.get(event.pluginId)
			: workerPlugin;
		if (!plugin?.slots.has(event.slot)) return;
		try {
			onUiState?.({
				pluginName: plugin.name,
				slot: event.slot,
				state: event.state,
			});
		} catch {
			// A host listener must not break the sandbox's message handling.
		}
	};
	const open = (descriptors: UiSlotPluginDescriptor[]) => {
		openedWith = descriptors;
		registered = new Map(
			descriptors.map((descriptor) => [
				descriptor.pluginId,
				{
					name: descriptor.name,
					slots: new Set(
						descriptor.contributions.uiSlots.map(({ slot }) => slot),
					),
				},
			]),
		);
		workerPlugin =
			transport === "worker" && registered.size === 1
				? [...registered.values()][0]
				: undefined;
		const pending = [...held.values()];
		held.clear();
		for (const event of pending) deliver(event);
	};

	return {
		receive(payload: unknown): void {
			if (!onUiState || typeof payload !== "object" || payload === null) {
				return;
			}
			const { pluginId, slot, state } = payload as Record<string, unknown>;
			if (typeof slot !== "string") return;
			const event = {
				pluginId: typeof pluginId === "string" ? pluginId : "",
				slot,
				state,
			};
			if (registered) {
				deliver(event);
				return;
			}
			const key = JSON.stringify([event.pluginId, slot]);
			if (held.has(key) || held.size < heldCapacity) {
				held.set(key, event);
			}
		},
		hold(): void {
			registered = undefined;
		},
		open,
		/** After a failed re-initialize: drop what it held and keep the last slots. */
		discardHeld(): void {
			held.clear();
			open(openedWith);
		},
	};
}
