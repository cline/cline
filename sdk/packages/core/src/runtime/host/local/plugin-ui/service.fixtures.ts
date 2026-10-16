import type {
	AgentExtensionUiSlot,
	ComposerSuggestionsState,
	ITelemetryService,
	PluginUiAction,
	PluginUiActionContext,
	PluginUiActionReply,
	PluginUiInvokeResult,
	PluginUiStateEnvelope,
} from "@cline/shared";
import { type Mock, vi } from "vitest";
import { PluginUiService, type PluginUiSession } from "./service";
import type { PluginUiStore } from "./store";

export const SLOT = "composer.suggestions";
export const PLUGIN = "next-turn";

type OnAction = (
	action: PluginUiAction,
	context: PluginUiActionContext,
) => PluginUiActionReply | Promise<PluginUiActionReply>;

export function readyState(revision: string): ComposerSuggestionsState {
	return {
		status: "ready",
		title: "Next",
		revision,
		canRefresh: false,
		items: [
			{
				id: "fix",
				label: "Fix",
				tone: "repair",
				prompt: "Fix the failing test",
				sendable: true,
			},
		],
	};
}

export function deferred<T = void>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

export function createHarness() {
	const sessions = new Map<string, PluginUiSession>();
	const emitted: PluginUiStateEnvelope[] = [];
	const capture: Mock = vi.fn();
	const telemetry = { capture } as unknown as ITelemetryService;
	const service = new PluginUiService({
		sessions: (sessionId) => sessions.get(sessionId),
		emit: (envelope) => emitted.push(envelope),
		telemetry,
	});

	function start(
		sessionId: string,
		options: {
			onAction?: OnAction;
			plugin?: string;
			/** A session whose plugins registered no handler for the slot. */
			unhandled?: boolean;
			slots?: Array<typeof SLOT>;
			initializeExtensions?: () => Promise<void>;
		} = {},
	) {
		const onAction: Mock<OnAction> = vi.fn<OnAction>(
			options.onAction ?? (() => ({ outcome: "ok" })),
		);
		const handler: AgentExtensionUiSlot & { plugin: string } = {
			slot: SLOT,
			plugin: options.plugin ?? PLUGIN,
			onAction: (action, context) => onAction(action, context),
		};
		const initializeExtensions: Mock<() => Promise<void>> = vi.fn(
			options.initializeExtensions ?? (async () => {}),
		);
		const session = {
			agent: {
				initializeExtensions,
				getExtensionRegistry: () => ({
					uiSlots: options.unhandled ? [] : [handler],
				}),
			},
			config: {},
		} as unknown as PluginUiSession;
		const epoch = service.begin(sessionId, options.slots ?? [SLOT]);
		sessions.set(sessionId, session);
		service.activate(sessionId, epoch);
		return { epoch, onAction, initializeExtensions };
	}

	function invoke(
		sessionId: string,
		action: unknown,
		viewer?: { id: string; clientType?: string },
		connectionId?: string,
	): Promise<PluginUiInvokeResult> {
		return service.invoke(
			{ sessionId, slot: SLOT, action: action as PluginUiAction },
			viewer,
			connectionId,
		);
	}

	function events(name: string) {
		return capture.mock.calls
			.map(([input]) => input as { event: string; properties: unknown })
			.filter((input) => input.event === name)
			.map((input) => input.properties);
	}

	// The service's private state, for asserting what teardown leaves behind.
	const store = Reflect.get(service, "store") as PluginUiStore;
	const chains = Reflect.get(service, "chains") as Map<string, unknown>;

	return {
		service,
		store,
		chains,
		sessions,
		emitted,
		capture,
		start,
		invoke,
		events,
	};
}

export const attach = { verb: "attach", surface: "desktop" } as const;
export const skip = {
	verb: "skip",
	input: "key",
	revision: "r1",
	itemId: "fix",
} as const;
