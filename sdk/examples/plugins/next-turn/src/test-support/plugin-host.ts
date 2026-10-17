import { Agent, type AgentPlugin } from "@cline/core";
import type {
	AgentExtensionUiSlot,
	ComposerSuggestionsAction,
	ComposerSuggestionsState,
	PluginUiActionReply,
	PluginUiContext,
	PluginUiSurface,
} from "@cline/shared";
import type { HubLinkDeps } from "../hub/link";
import { EMPTY_BACKLOG } from "../planner/backlog";
import { type NextOptions, NextSession } from "../planner/session/session";
import type { RunCommand } from "../run";
import { type SessionRuntime, type SetupContext, sessionEnv } from "../runtime";
import { defaultSettings } from "../settings/settings";
import { editingModel, editorTool } from "./agent-runs";

/**
 * Fixtures the test files share. Only `*.test.ts` files import this module,
 * so it never reaches the bundle or its load budget.
 */

export const cliSetupContext: SetupContext = {
	session: { sessionId: "sess_1" },
	client: { name: "cline-cli" },
	workspaceInfo: {
		rootPath: "/w",
		latestGitBranchName: "main",
		associatedRemoteUrls: ["git@github.com:o/r.git"],
	},
};

/**
 * A runtime around `next` with no hub, sources or connectors. It is always
 * viewed, as on a host that renders no slot, and `setViewed` returns
 * whatever `next` it holds.
 */
export function fakeRuntime(
	next?: NextSession,
	overrides: Partial<SessionRuntime> = {},
): SessionRuntime {
	const runtime: SessionRuntime = {
		next,
		setViewed: () => runtime.next,
		viewed: () => true,
		recordDormantTurn: () => {},
		setTools: () => {},
		stop: () => {},
		...overrides,
	};
	return runtime;
}

/**
 * A host that renders the `composer.suggestions` slot, as core offers it to
 * a worker plugin: `api` and `ui` go to `setup`, `states` holds every state
 * published, and `invoke` delivers a verb from a viewer the way core does,
 * counting viewers after it.
 */
export function fakeSlotHost(
	slots: readonly string[] = ["composer.suggestions"],
) {
	const states: (ComposerSuggestionsState | null)[] = [];
	const viewers = new Set<string>();
	let registered: AgentExtensionUiSlot | undefined;
	const ui: PluginUiContext = {
		slots,
		update: (_slot, state) => {
			states.push(state);
		},
	};
	return {
		api: {
			registerUiSlot: (slot: AgentExtensionUiSlot) => {
				registered = slot;
			},
		},
		ui,
		states,
		registered: () => registered,
		latest: () => states.at(-1),
		invoke(
			action: ComposerSuggestionsAction,
			viewerId = "local",
		): PluginUiActionReply | Promise<PluginUiActionReply> {
			if (action.verb === "attach") viewers.add(viewerId);
			if (action.verb === "detach") viewers.delete(viewerId);
			if (!registered) throw new Error("no slot registered");
			return registered.onAction(action, {
				sessionId: "sess_1",
				viewer: { id: viewerId },
				viewers: viewers.size,
			});
		},
	};
}

/** Lets detached work started by a slot verb (an attach's serve) settle. */
export function flushDetached(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A lifecycle that never reads the developer's own Cline settings. */
export const alwaysActive = { active: () => true };

/** No hub is running: the link reports `off` and never connects. */
export const offlineHub: HubLinkDeps = {
	resolveEndpoint: async () => undefined,
	createClient: () => {
		throw new Error("no hub in tests");
	},
	sleep: () => new Promise(() => {}),
};

/** A machine with neither `gh` nor `git` installed. */
export const noCommands: RunCommand = async () => {
	throw Object.assign(new Error("not installed"), { code: "ENOENT" });
};

/**
 * Next around a runtime that keeps it dormant until viewed, as
 * `startSessionRuntime` does: `viewing` records each `setViewed`, each start
 * of Next and each turn recorded while dormant.
 */
export function presence(
	nextOptions: Partial<NextOptions> = {},
	runtimeOverrides: Partial<SessionRuntime> = {},
	nextOn: () => boolean = () => true,
) {
	const viewing = {
		viewed: false,
		activated: 0,
		dormant: 0,
		calls: [] as [boolean, PluginUiSurface | undefined][],
	};
	const next = new NextSession({
		sessionId: "sess_1",
		settings: defaultSettings,
		env: sessionEnv(cliSetupContext, { tools: () => [] }),
		sources: () => [{ id: "turn", tier: "T0", probe: () => "present" }],
		backlog: async () => EMPTY_BACKLOG,
		viewed: () => viewing.viewed,
		...nextOptions,
	});
	const runtime: SessionRuntime = fakeRuntime(undefined, {
		setViewed: (viewed, surface) => {
			viewing.viewed = viewed;
			viewing.calls.push([viewed, surface]);
			if (viewed && !runtime.next && nextOn()) {
				viewing.activated += 1;
				runtime.next = next;
			}
			return runtime.next;
		},
		viewed: () => viewing.viewed,
		recordDormantTurn: () => {
			viewing.dormant += 1;
		},
		...runtimeOverrides,
	});
	const start = (_context: SetupContext, { active }: { active: boolean }) => {
		if (active) runtime.setViewed(true);
		return runtime;
	};
	return { next, runtime, viewing, start };
}

export function agentFor(plugin: AgentPlugin): Agent {
	return new Agent({
		model: editingModel().model,
		tools: [editorTool],
		hooks: plugin.hooks,
	});
}

export function slotContext(
	host: ReturnType<typeof fakeSlotHost>,
	extra: Partial<SetupContext> = {},
): SetupContext {
	return {
		...cliSetupContext,
		client: { name: "cline-desktop" },
		ui: host.ui,
		...extra,
	};
}
