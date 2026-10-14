import type { AgentPlugin } from "@cline/core";
import type { AgentRuntimeStateSnapshot } from "@cline/shared";
import { DESKTOP_CLIENT_NAME, PLUGIN_NAME } from "./config";
import { PluginLifecycle } from "./lifecycle";
import { type Log, pluginLog } from "./log";
import {
	type OfferedSet,
	parseTrayAction,
	type TrayPush,
} from "./planner/tray";
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

/** Structural slice of the `ui-slots` API (`registerUiHandler` on `api`, `ui.push` on `context`). */
type UiSlotPluginApi = {
	registerUiHandler?: (
		name: string,
		handler: (input: unknown) => Promise<unknown> | unknown,
	) => void;
};

type UiSlotSetupContext = SetupContext & {
	ui?: {
		push: (event: string, payload: unknown) => void;
	};
};

export type NextTurnPluginOptions = {
	/** Starts this session's runtime, or returns nothing when no feature needs it. Tests replace it. */
	startRuntime?: (
		context: SetupContext,
		options: { active: boolean },
	) => SessionRuntime | undefined;
	/** Checks whether the plugin is still enabled and installed. */
	lifecycle?: { active(): boolean };
};

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
 * Default viewer gate. A host without UI slots serves every set to the debug
 * log, so Next starts at once; with slots, the desktop app starts at once and
 * any other client waits until a viewer asks for `current`.
 */
export function defaultIsNextActive(
	api: UiSlotPluginApi,
	context: UiSlotSetupContext,
): boolean {
	return (
		typeof api?.registerUiHandler !== "function" ||
		context.client?.name === DESKTOP_CLIENT_NAME
	);
}

/**
 * Next Turn as one plugin. Setup builds the session's runtime;
 * the run hooks feed it:
 * - `beforeModel` records the agent's tools, a capability source, and labels
 *   the person's new message against the set on screen once per `runId`.
 *   `beforeRun` cannot: its snapshot predates the new message;
 * - `afterRun` derives the turn and returns; the rule-based set, the planner
 *   and the connector refresher's check of whether the turn pushed follow
 *   without holding up the run.
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
	const lifecycle = options.lifecycle ?? new PluginLifecycle();
	const checkActive = (): boolean => {
		const nowActive = lifecycle.active();
		if (!nowActive && wasActive) {
			wasActive = false;
			runtime?.connectors?.refresher.stop();
			runtime?.next?.off();
		} else if (nowActive && !wasActive) {
			wasActive = true;
			void runtime?.connectors?.refresher
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
					runtime?.setTools(context.request.tools.map((tool) => tool.name));
					runtime?.next?.outgoing(context.request.messages);
				} catch (error) {
					log("beforeModel failed", error);
				}
				return undefined;
			},
			async afterRun(context) {
				if (!runtime || !isRootRun(context.snapshot) || !checkActive()) return;
				if (!runtime.next) {
					try {
						runtime.recordDormantTurn(context.result);
					} catch (error) {
						log("afterRun dormant turn failed", error);
					}
					return;
				}
				const served = runtime.next
					.afterRun(context.result)
					.catch((error: unknown) => log("afterRun failed", error));
				const pushed = runtime.next.turn()?.pushed ?? false;
				const refresher = runtime.connectors?.refresher;
				served
					.then(() => refresher?.onTurn({ pushed }))
					.catch((error: unknown) => log("a refresh failed", error));
			},
		},
		setup(rawApi, rawContext) {
			const api = (rawApi ?? {}) as UiSlotPluginApi;
			const context = (rawContext ?? {}) as UiSlotSetupContext;
			const sessionId = context.session?.sessionId ?? "";
			log = pluginLog(context);
			startError = undefined;
			lastBeforeModelRunId = undefined;
			wasActive = lifecycle.active();
			const active = defaultIsNextActive(api, context);
			const pushToSlot = (payload: TrayPush) => {
				try {
					context.ui?.push("next.state", payload);
				} catch (error) {
					log("ui.push failed", error);
				}
			};
			let subscribedNext: unknown;
			const bindNext = () => {
				const next = runtime?.next;
				if (!next || next === subscribedNext) return;
				subscribedNext = next;
				next.onSet(logSet(context));
				next.onPush(pushToSlot);
			};
			void stopRuntime(runtime);
			runtime = undefined;
			try {
				const started = start(context, { active });
				runtime = started;
				context.onDispose?.(() => stopRuntime(started));
				bindNext();
			} catch (error) {
				startError = errorMessage(error);
				log("the runtime did not start", error);
			}
			if (typeof api.registerUiHandler === "function") {
				const off: TrayPush = { sessionId, seq: 0, state: "off" };
				api.registerUiHandler("next", async (rawInput: unknown) => {
					const action = parseTrayAction(rawInput);
					if (!action) throw new Error("invalid NextTurnTrayAction");
					if (!checkActive()) return runtime?.next?.off() ?? off;
					if (startError) {
						return {
							sessionId,
							seq: 0,
							state: "unavailable",
							error: startError,
						} satisfies TrayPush;
					}
					if (!runtime || !sessionId) return off;
					if (action.type === "current") {
						if (!runtime.next) {
							runtime.activateNext(action.client);
							bindNext();
						}
						if (!runtime.next) return off;
						return await runtime.next.ensureCurrent(action.runCount);
					}
					if (!runtime.next) return off;
					return runtime.next.invoke(action);
				});
			}
		},
	};
}
