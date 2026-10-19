import type { AgentPlugin } from "@cline/core";
import type {
	AgentExtensionApi,
	AgentRuntimeStateSnapshot,
	ComposerSuggestionsAction,
	ComposerSuggestionsState,
	PluginSetupContext,
	PluginUiActionContext,
	PluginUiActionReply,
	PluginUiContext,
	PluginUiSurface,
} from "@cline/shared";
import { PLUGIN_NAME } from "./config";
import { PluginLifecycle } from "./lifecycle";
import { type Log, pluginLog } from "./log";
import type { NextSession } from "./planner/session/session";
import type { OfferedSet, TrayPush } from "./planner/tray/tray";
import { toTrayActions } from "./planner/tray/verbs";
import { dormantState, toSuggestionsState } from "./planner/tray/view";
import {
	type SessionRuntime,
	type SetupContext,
	startSessionRuntime,
} from "./runtime";
import {
	effectiveSettings,
	loadSettingsFile,
	type Settings,
} from "./settings/settings";
import { cachedByFile, nextTurnPaths } from "./store/data-dir";
import { errorMessage } from "./values";

export type NextTurnPluginOptions = {
	/** Starts this session's runtime, or returns nothing when no feature needs it. Tests replace it. */
	startRuntime?: (
		context: SetupContext,
		options: { active: boolean },
	) => SessionRuntime | undefined;
	/** Checks whether the plugin is still enabled and installed. */
	lifecycle?: { active(): boolean };
};

const OK = { outcome: "ok" } as const;
/** The set an action named is gone, so the host sends nothing. */
const STALE = { outcome: "refused", reason: "stale" } as const;

/** Re-reads the settings file whenever it changes, so a change from the desktop or the CLI applies to the next decision. */
function settingsReader(context: SetupContext): () => Settings {
	const path = nextTurnPaths().settings;
	const workspaceRoot = context.workspaceInfo?.rootPath;
	return cachedByFile(path, () =>
		effectiveSettings(loadSettingsFile(path), workspaceRoot),
	);
}

/** The set's shape, never its text, in the session's debug log. */
function logSet(context: SetupContext): (set: OfferedSet | undefined) => void {
	return (set) => {
		if (!set) return;
		context.logger?.debug(`[${PLUGIN_NAME}] suggestions`, {
			offerId: set.offerId,
			planner: set.planner,
			kinds: set.candidates.map((candidate) => candidate.kind),
			sources: set.candidates.map((candidate) => candidate.source),
		});
	};
}

/** Suggestions follow the person's chat, not the sub-agents it starts. */
function isRootRun(snapshot: AgentRuntimeStateSnapshot): boolean {
	return !snapshot.parentAgentId;
}

/**
 * Whether this session's host renders Cline's `composer.suggestions` slot.
 * Both halves of the slot API are needed: an in-process extension always sees
 * `registerUiSlot` but never gets `ctx.ui`, and a host's catalog can name
 * other slots only.
 */
function slotOffered(
	api: Partial<Pick<AgentExtensionApi, "registerUiSlot">> | undefined,
	context: Pick<PluginSetupContext, "ui">,
): boolean {
	return (
		typeof api?.registerUiSlot === "function" &&
		context.ui?.slots?.includes("composer.suggestions") === true
	);
}

/**
 * Default viewer gate. A session whose host renders no slot starts Next at
 * once and serves every set to the debug log; one that renders the slot
 * keeps Next dormant until a viewer attaches.
 */
export function defaultIsNextActive(
	api: Partial<Pick<AgentExtensionApi, "registerUiSlot">> | undefined,
	context: Pick<PluginSetupContext, "ui">,
): boolean {
	return !slotOffered(api, context);
}

/**
 * Next Turn as one plugin. Setup builds the session's runtime, and a hook
 * builds it later when setup needed none and the settings have since turned
 * a feature on. The run hooks feed it:
 * - `beforeModel` records the agent's tools, a capability source, and once
 *   per `runId` takes the set down, since the turn it answered is no longer
 *   the chat's latest, labelling the person's new message against it.
 *   `beforeRun` cannot: its snapshot predates the new message;
 * - `afterRun` derives the turn and waits for its context, which the source,
 *   git and backlog read budgets bound; the planner then writes the turn's
 *   one set, falling back to the rule-based set, and the connectors' check
 *   for new connections and for a push follow without holding up the run.
 *   A one-shot run that closes the sandbox before the planner answers is
 *   served the rule-based set at dispose.
 *
 * On a host that renders the `composer.suggestions` slot, setup registers
 * it: sets stream to the slot, its verbs drive Next, and Next works only
 * while a viewer is attached. Elsewhere Next starts at once and logs each
 * set to debug.
 *
 * No hook can fail the person's run: each catches its own errors.
 */
type ComposerSlot = ReturnType<typeof composerSlot>;

/**
 * The session's runtime and its start failure: setup starts it once, and a
 * hook starts it later when setup started none and the settings have since
 * turned a feature on. A start that throws is remembered, so the next turn
 * reports it rather than retrying forever.
 */
function runtimeSlot(options: {
	start: (context: SetupContext, active: boolean) => SessionRuntime | undefined;
	lifecycle: { active(): boolean };
	log: Log;
	/** Runs after every start: setup registers disposal, restores the viewer surface and subscribes the slot. */
	started: (runtime: SessionRuntime) => void;
}) {
	let runtime: SessionRuntime | undefined;
	let startError: string | undefined;
	let wasActive = true;
	let retry: () => void = () => {};
	const stop = (stopping: SessionRuntime | undefined) =>
		Promise.resolve()
			.then(() => stopping?.stop())
			.catch((error: unknown) => options.log("the runtime did not stop", error));
	const begin = (
		context: SetupContext,
		active: boolean,
	): SessionRuntime | undefined => {
		try {
			const started = options.start(context, active);
			if (!started) return undefined;
			runtime = started;
			options.started(started);
			return started;
		} catch (error) {
			startError = errorMessage(error);
			options.log("the runtime did not start", error);
			return undefined;
		}
	};
	return {
		begin,
		stop,
		/** The runtime, started now when setup started none and the settings have since turned a feature on. */
		ensure(): SessionRuntime | undefined {
			if (!runtime && !startError) retry();
			return runtime;
		},
		/** Follows the plugin's enabled state: while it is off the refresher stops and the tray goes off; back on, both resume. */
		checkActive(): boolean {
			const nowActive = options.lifecycle.active();
			if (!nowActive && wasActive) {
				wasActive = false;
				runtime?.connectors?.refresher.stop();
				runtime?.next?.off("disabled");
			} else if (nowActive && !wasActive) {
				wasActive = true;
				if (runtime?.viewed())
					void runtime.connectors?.refresher
						.start()
						.catch((error: unknown) =>
							options.log("the refresher stopped", error),
						);
			}
			return nowActive;
		},
		onRetry(tryStart: () => void): void {
			retry = tryStart;
		},
		reset(): void {
			startError = undefined;
			wasActive = options.lifecycle.active();
		},
		stopCurrent(): void {
			void stop(runtime);
			runtime = undefined;
		},
		get runtime(): SessionRuntime | undefined {
			return runtime;
		},
		get startError(): string | undefined {
			return startError;
		},
	};
}

/**
 * The `composer.suggestions` half: pushes render into the slot, attach and
 * show serve the chat's current set, and the verbs drive Next. A runtime
 * started later is marked viewed with the surface attached now.
 */
function composerSlot(options: {
	ui: PluginUiContext;
	sessionId: string;
	runtime: () => SessionRuntime | undefined;
	ensure: () => SessionRuntime | undefined;
	startError: () => string | undefined;
	checkActive: () => boolean;
	bindNext: () => void;
	log: Log;
}) {
	/** The surface of the viewer attached now, so a runtime started later starts viewed. */
	let surface: PluginUiSurface | undefined;
	/** The newest set published: the revision of a state with no set of its own. */
	let lastRevision: string | undefined;
	const publishState = (state: ComposerSuggestionsState) => {
		try {
			options.ui.update("composer.suggestions", state);
		} catch (error) {
			options.log("ui.update failed", error);
		}
	};
	const publish = (push: TrayPush) => {
		lastRevision = push.set?.offerId ?? lastRevision;
		publishState(
			toSuggestionsState(push, {
				facts: options.runtime()?.next?.turn()?.facts,
				lastRevision,
			}),
		);
	};
	const disabledPush = (): TrayPush => ({
		sessionId: options.sessionId,
		seq: 0,
		state: "off",
		offReason: "disabled",
	});
	/** Serves the chat's current set without holding the slot's verbs behind it. */
	const serveCurrent = (next: NextSession) => {
		void next
			.ensureCurrent()
			.then(() => publish(next.currentPush()))
			.catch((error: unknown) => options.log("attach serve failed", error));
	};
	const onAction = (
		action: ComposerSuggestionsAction,
		viewing: PluginUiActionContext,
	): PluginUiActionReply => {
		const trayActions = toTrayActions(action);
		if (!trayActions) return { outcome: "refused" };
		if (action.verb === "detach") {
			if (viewing.viewers === 0) {
				surface = undefined;
				options.runtime()?.setViewed(false);
			}
			return OK;
		}
		if (action.verb === "attach") surface = action.surface;
		if (!options.checkActive()) {
			if (action.verb === "attach")
				options.runtime()?.setViewed(true, action.surface);
			publish(options.runtime()?.next?.off("disabled") ?? disabledPush());
			// Off withdrew the set, so Use and Send must not fill or submit its prompt.
			return action.verb === "use" || action.verb === "send" ? STALE : OK;
		}
		options.ensure();
		const error = options.startError();
		if (error) {
			publish({
				sessionId: options.sessionId,
				seq: 0,
				state: "unavailable",
				error,
			});
			return OK;
		}
		if (action.verb === "attach" || action.verb === "show") {
			const next = options.runtime()?.setViewed(
				true,
				action.verb === "attach" ? action.surface : undefined,
			);
			if (!next) {
				publish(disabledPush());
				return OK;
			}
			options.bindNext();
			if (action.verb === "show") next.show();
			serveCurrent(next);
			return OK;
		}
		const next = options.runtime()?.next;
		if (!next) return STALE;
		const refused = trayActions
			.map((trayAction) => next.invoke(trayAction).refused)
			.find(Boolean);
		return refused ? { outcome: "refused", reason: refused } : OK;
	};
	return {
		onAction,
		publish,
		publishState,
		get surface(): PluginUiSurface | undefined {
			return surface;
		},
	};
}

export function createNextTurnPlugin(
	options: NextTurnPluginOptions = {},
): AgentPlugin {
	let lastBeforeModelRunId: string | undefined;
	let log: Log = () => {};
	let context: SetupContext = {};
	let slot: ComposerSlot | undefined;
	const lifecycle = options.lifecycle ?? new PluginLifecycle();
	const start =
		options.startRuntime ??
		((setup: SetupContext, { active }: { active: boolean }) =>
			startSessionRuntime(setup, {
				settings: settingsReader(setup),
				active,
				pluginActive: () => lifecycle.active(),
			}));
	/** Subscribes the slot and the debug log to a Next started since. */
	let subscribedNext: unknown;
	const bindNext = () => {
		const next = runtime.runtime?.next;
		if (!next || next === subscribedNext) return;
		subscribedNext = next;
		next.onSet(logSet(context));
		next.onPush((push) => slot?.publish(push));
	};
	const runtime = runtimeSlot({
		start: (setup, active) => start(setup, { active }),
		lifecycle,
		log: (message, error) => log(message, error),
		started: (started) => {
			context.onDispose?.(() => runtime.stop(started));
			if (slot?.surface) started.setViewed(true, slot.surface);
			bindNext();
		},
	});
	return {
		name: PLUGIN_NAME,
		manifest: { capabilities: ["hooks"] },
		hooks: {
			beforeModel(hook) {
				try {
					if (!isRootRun(hook.snapshot)) return undefined;
					const runId = hook.snapshot.runId;
					if (runId && runId === lastBeforeModelRunId) return undefined;
					if (!runtime.checkActive()) return undefined;
					if (runId) lastBeforeModelRunId = runId;
					const current = runtime.ensure();
					current?.setTools(hook.request.tools.map((tool) => tool.name));
					current?.next?.outgoing(hook.request.messages);
				} catch (error) {
					log("beforeModel failed", error);
				}
				return undefined;
			},
			async afterRun(hook) {
				if (!isRootRun(hook.snapshot) || !runtime.checkActive()) return;
				const current = runtime.ensure();
				if (!current) return;
				if (!current.next && current.viewed()) {
					try {
						current.setViewed(true);
						bindNext();
					} catch (error) {
						log("Next did not start", error);
					}
				}
				const next = current.next;
				if (!next) {
					try {
						current.recordDormantTurn(hook.result);
					} catch (error) {
						log("afterRun dormant turn failed", error);
					}
					return;
				}
				const served = next
					.afterRun(hook.result)
					.catch((error: unknown) => log("afterRun failed", error));
				const pushed = next.turn()?.pushed ?? false;
				const connectors = current.connectors;
				served
					.then(() =>
						current.viewed() ? connectors?.onTurn({ pushed }) : undefined,
					)
					.catch((error: unknown) => log("a refresh failed", error));
				await served;
			},
		},
		setup(rawApi, rawContext) {
			const api: Partial<Pick<AgentExtensionApi, "registerUiSlot">> =
				rawApi ?? {};
			context = rawContext ?? {};
			const sessionId = context.session?.sessionId ?? "";
			log = pluginLog(context);
			lastBeforeModelRunId = undefined;
			runtime.reset();
			const active = defaultIsNextActive(api, context);
			slot =
				active || !context.ui
					? undefined
					: composerSlot({
							ui: context.ui,
							sessionId,
							runtime: () => runtime.runtime,
							ensure: () => runtime.ensure(),
							startError: () => runtime.startError,
							checkActive: () => runtime.checkActive(),
							bindNext,
							log: (message, error) => log(message, error),
						});
			runtime.onRetry(() => {
				runtime.begin(context, active);
			});
			if (slot)
				api.registerUiSlot?.({
					slot: "composer.suggestions",
					onAction: slot.onAction,
				});
			runtime.stopCurrent();
			const started = runtime.ensure();
			if (!started?.viewed()) slot?.publishState(dormantState());
		},
	};
}
