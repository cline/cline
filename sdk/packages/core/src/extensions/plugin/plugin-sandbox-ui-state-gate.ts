import type {
	PluginSandboxOptions,
	PluginSandboxTransport,
	UiStateEvent,
} from "./plugin-sandbox";

type UiSlotPluginDescriptor = {
	name: string;
	contributions: { uiSlots: ReadonlyArray<{ slot: string }> };
};

const MAX_HELD_UI_STATES = 8;

/**
 * Routes the sandbox's UI state events to `onUiState`. Until `initialize` (or
 * a re-initialize after idle reclaim) returns, it holds the latest state per
 * plugin and slot. Then it forwards a state only for a slot the plugin's
 * descriptor registered. A worker runs one plugin, so the worker transport
 * stamps that plugin's name whatever the payload claims; the subprocess
 * transport can only trust the payload's name.
 */
export function createUiStateGate(
	transport: PluginSandboxTransport | undefined,
	onUiState: PluginSandboxOptions["onUiState"],
) {
	const held = new Map<string, UiStateEvent>();
	let registeredSlots: Map<string, ReadonlySet<string>> | undefined;
	let workerPluginName: string | undefined;
	let openedWith: UiSlotPluginDescriptor[] = [];

	const deliver = (event: UiStateEvent) => {
		const pluginName = workerPluginName ?? event.pluginName;
		if (!registeredSlots?.get(pluginName)?.has(event.slot)) return;
		try {
			onUiState?.({ pluginName, slot: event.slot, state: event.state });
		} catch {
			// A host listener must not break the sandbox's message handling.
		}
	};
	const open = (descriptors: UiSlotPluginDescriptor[]) => {
		openedWith = descriptors;
		registeredSlots = new Map(
			descriptors.map((descriptor) => [
				descriptor.name,
				new Set(descriptor.contributions.uiSlots.map(({ slot }) => slot)),
			]),
		);
		workerPluginName =
			transport === "worker" && descriptors.length === 1
				? descriptors[0]?.name
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
			const { pluginName, slot, state } = payload as Record<string, unknown>;
			if (typeof slot !== "string") return;
			const event = {
				pluginName: typeof pluginName === "string" ? pluginName : "",
				slot,
				state,
			};
			if (registeredSlots) {
				deliver(event);
				return;
			}
			const key = JSON.stringify([event.pluginName, slot]);
			if (held.has(key) || held.size < MAX_HELD_UI_STATES) {
				held.set(key, event);
			}
		},
		hold(): void {
			registeredSlots = undefined;
		},
		open,
		/** After a failed re-initialize: drop what it held and keep the last slots. */
		discardHeld(): void {
			held.clear();
			open(openedWith);
		},
	};
}
