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
 * - `beforeModel` records the agent's tools, a capability source, and labels
 *   the person's new message against the set on screen once per `runId`.
 *   `beforeRun` cannot: its snapshot predates the new message;
 * - `afterRun` derives the turn and waits for the rule-based set, which the
 *   source, git and backlog read budgets bound, since a one-shot run closes
 *   the sandbox as soon as the hook returns; the planner and the connectors'
 *   check for new connections and for a push follow without holding up the
 *   run.
 *
 * On a host that renders the `composer.suggestions` slot, setup registers
 * it: sets stream to the slot, its verbs drive Next, and Next works only
 * while a viewer is attached. Elsewhere Next starts at once and logs each
 * set to debug.
 *
 * No hook can fail the person's run: each catches its own errors.
 */
export function createNextTurnPlugin(
	options: NextTurnPluginOptions = {},
): AgentPlugin {
	let runtime: SessionRuntime | undefined;
	let startError: string | undefined;
	let lastBeforeModelRunId: string | undefined;
	let wasActive = true;
	let log: Log = () => {};
	/** Tries setup's start again; setup sets it. */
	let retryStart: () => void = () => {};
	/** Subscribes the slot and the debug log to a Next started since; setup sets it. */
	let bindNext: () => void = () => {};
	/** The runtime, started now when setup started none and the settings have since turned a feature on. */
	const ensureRuntime = (): SessionRuntime | undefined => {
		if (!runtime && !startError) retryStart();
		return runtime;
	};
	const lifecycle = options.lifecycle ?? new PluginLifecycle();
	const checkActive = (): boolean => {
		const nowActive = lifecycle.active();
		if (!nowActive && wasActive) {
			wasActive = false;
			runtime?.connectors?.refresher.stop();
			runtime?.next?.off("disabled");
		} else if (nowActive && !wasActive) {
			wasActive = true;
			if (runtime?.viewed())
				void runtime.connectors?.refresher
					.start()
					.catch((error: unknown) => log("the refresher stopped", error));
		}
		return nowActive;
	};
	const start =
		options.startRuntime ??
		((context: SetupContext, { active }: { active: boolean }) =>
			startSessionRuntime(context, {
				settings: settingsReader(context),
				active,
				pluginActive: () => lifecycle.active(),
			}));
	const stopRuntime = (stopping: SessionRuntime | undefined) =>
		Promise.resolve()
			.then(() => stopping?.stop())
			.catch((error: unknown) => log("the runtime did not stop", error));
	return {
		name: PLUGIN_NAME,
		manifest: { capabilities: ["hooks"] },
		hooks: {
			beforeModel(context) {
				try {
					if (!isRootRun(context.snapshot)) return undefined;
					const runId = context.snapshot.runId;
					if (runId && runId === lastBeforeModelRunId) return undefined;
					if (!checkActive()) return undefined;
					if (runId) lastBeforeModelRunId = runId;
					const current = ensureRuntime();
					current?.setTools(context.request.tools.map((tool) => tool.name));
					current?.next?.outgoing(context.request.messages);
				} catch (error) {
					log("beforeModel failed", error);
				}
				return undefined;
			},
			async afterRun(context) {
				if (!isRootRun(context.snapshot) || !checkActive()) return;
				const current = ensureRuntime();
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
						current.recordDormantTurn(context.result);
					} catch (error) {
						log("afterRun dormant turn failed", error);
					}
					return;
				}
				const served = next
					.afterRun(context.result)
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
			const context: SetupContext = rawContext ?? {};
			const sessionId = context.session?.sessionId ?? "";
			log = pluginLog(context);
			startError = undefined;
			lastBeforeModelRunId = undefined;
			wasActive = lifecycle.active();
			const active = defaultIsNextActive(api, context);
			const slotUi: PluginUiContext | undefined = active
				? undefined
				: context.ui;
			/** The surface of the viewer attached now, so a runtime started later starts viewed. */
			let attachedSurface: PluginUiSurface | undefined;
			/** The newest set published: the revision of a state with no set of its own. */
			let lastRevision: string | undefined;
			const publishState = (state: ComposerSuggestionsState) => {
				if (!slotUi) return;
				try {
					slotUi.update("composer.suggestions", state);
				} catch (error) {
					log("ui.update failed", error);
				}
			};
			const publish = (push: TrayPush) => {
				lastRevision = push.set?.offerId ?? lastRevision;
				publishState(
					toSuggestionsState(push, {
						facts: runtime?.next?.turn()?.facts,
						lastRevision,
					}),
				);
			};
			const disabledPush = (): TrayPush => ({
				sessionId,
				seq: 0,
				state: "off",
				offReason: "disabled",
			});
			/** Serves the chat's current set without holding the slot's verbs behind it. */
			const serveCurrent = (next: NextSession) => {
				void next
					.ensureCurrent()
					.then(() => publish(next.currentPush()))
					.catch((error: unknown) => log("attach serve failed", error));
			};
			const onAction = (
				action: ComposerSuggestionsAction,
				viewing: PluginUiActionContext,
			): PluginUiActionReply => {
				const trayActions = toTrayActions(action);
				if (!trayActions) return { outcome: "refused" };
				if (action.verb === "detach") {
					if (viewing.viewers === 0) {
						attachedSurface = undefined;
						runtime?.setViewed(false);
					}
					return OK;
				}
				if (action.verb === "attach") attachedSurface = action.surface;
				if (!checkActive()) {
					if (action.verb === "attach")
						runtime?.setViewed(true, action.surface);
					publish(runtime?.next?.off("disabled") ?? disabledPush());
					// Off withdrew the set, so Use and Send must not fill or submit its prompt.
					return action.verb === "use" || action.verb === "send" ? STALE : OK;
				}
				ensureRuntime();
				if (startError) {
					publish({
						sessionId,
						seq: 0,
						state: "unavailable",
						error: startError,
					});
					return OK;
				}
				if (action.verb === "attach" || action.verb === "show") {
					const next = runtime?.setViewed(
						true,
						action.verb === "attach" ? action.surface : undefined,
					);
					if (!next) {
						publish(disabledPush());
						return OK;
					}
					bindNext();
					if (action.verb === "show") next.show();
					serveCurrent(next);
					return OK;
				}
				const next = runtime?.next;
				if (!next) return STALE;
				const refused = trayActions
					.map((trayAction) => next.invoke(trayAction).refused)
					.find(Boolean);
				return refused ? { outcome: "refused", reason: refused } : OK;
			};
			let subscribedNext: unknown;
			bindNext = () => {
				const next = runtime?.next;
				if (!next || next === subscribedNext) return;
				subscribedNext = next;
				next.onSet(logSet(context));
				next.onPush(publish);
			};
			retryStart = () => {
				try {
					const started = start(context, { active });
					if (!started) return;
					runtime = started;
					context.onDispose?.(() => stopRuntime(started));
					if (attachedSurface) started.setViewed(true, attachedSurface);
					bindNext();
				} catch (error) {
					startError = errorMessage(error);
					log("the runtime did not start", error);
				}
			};
			if (slotUi)
				api.registerUiSlot?.({ slot: "composer.suggestions", onAction });
			void stopRuntime(runtime);
			runtime = undefined;
			const started = ensureRuntime();
			if (!started?.viewed()) publishState(dormantState());
		},
	};
}
