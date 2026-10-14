import { homedir } from "node:os";
import type { AgentPlugin } from "@cline/core";
import type { AgentRuntimeStateSnapshot } from "@cline/shared";
import { DESKTOP_CLIENT_NAME, PLUGIN_NAME } from "./config";
import { PluginLifecycle } from "./lifecycle";
import {
	type OfferedSet,
	parseTrayAction,
	type TrayPush,
} from "./planner/next";
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
import { nextTurnPaths, resolveClineDataDir } from "./store/data-dir";

export type { SetupContext };

/** Structural slice of the `ui-slots` API (`registerUiHandler` on `api`, `ui.push` on `context`). */
export type UiSlotPluginApi = {
	registerUiHandler?: (
		name: string,
		handler: (input: unknown) => Promise<unknown> | unknown,
	) => void;
};

export type UiSlotSetupContext = SetupContext & {
	ui?: {
		push: (event: string, payload: unknown) => void;
	};
};

export type NextTurnPluginOptions = {
	/** Starts this session's runtime, or returns nothing when no feature needs it. Tests replace it. */
	startRuntime?: (
		context: SetupContext,
		options?: { active?: boolean },
	) => SessionRuntime | undefined;
	/** Where served sets go until the UI slot gives them a tray; by default, the session's debug log. */
	onSet?: (context: SetupContext) => (set: OfferedSet | undefined) => void;
	/** Overrides the viewer gate (`registerUiHandler` present and `client.name === "cline-desktop"`). */
	isNextActive?: (api: UiSlotPluginApi, context: UiSlotSetupContext) => boolean;
	/** Checks whether the plugin is still enabled and installed. */
	lifecycle?: { active(): boolean };
};

/** Reads the settings file each call, so a change from the desktop or the CLI applies to the next decision. */
export function settingsReader(
	context: SetupContext,
	env: NodeJS.ProcessEnv = process.env,
	home: string = homedir(),
): () => Settings {
	const path = nextTurnPaths(resolveClineDataDir(env, home)).settings;
	const workspaceRoot = context.workspaceInfo?.rootPath;
	return () => effectiveSettings(loadSettingsFile(path), workspaceRoot);
}

/** The set's shape, never its text, in the session's debug log. */
export function logSet(
	context: SetupContext,
): (set: OfferedSet | undefined) => void {
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

/** Default viewer gate: active at setup only when the host provides UI slots and the client is the desktop app. */
export function defaultIsNextActive(
	api: UiSlotPluginApi,
	context: UiSlotSetupContext,
): boolean {
	return (
		typeof api?.registerUiHandler === "function" &&
		context.client?.name === DESKTOP_CLIENT_NAME
	);
}

/**
 * Next Turn as one plugin. Setup builds the session's runtime;
 * the run hooks feed it:
 * - `beforeModel` records the agent's tools, a capability source, and labels
 *   the person's new message against the set on screen once per `runId`.
 *   `beforeRun` cannot: its snapshot predates the new message;
 * - `afterRun` derives the turn, serves the rule-based set, starts the planner
 *   and tells the connector refresher whether the turn pushed.
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
	let pushOff: (() => void) | undefined;
	let log: (message: string, error?: unknown) => void = () => {};
	const lifecycle = options.lifecycle ?? new PluginLifecycle();
	const isActive = options.isNextActive ?? defaultIsNextActive;
	const checkActive = (): boolean => {
		const nowActive = lifecycle.active();
		if (!nowActive && wasActive) {
			wasActive = false;
			runtime?.connectors?.refresher.stop();
			pushOff?.();
		} else if (nowActive && !wasActive) {
			wasActive = true;
			void runtime?.connectors?.refresher.start().catch(() => {});
		}
		return nowActive;
	};
	const start =
		options.startRuntime ??
		((context: SetupContext, runtimeOpts?: { active?: boolean }) =>
			startSessionRuntime(context, {
				settings: settingsReader(context),
				onSet: (options.onSet ?? logSet)(context),
				active: runtimeOpts?.active,
			}));
	return {
		name: PLUGIN_NAME,
		manifest: { capabilities: ["hooks"] },
		hooks: {
			beforeModel(context) {
				try {
					if (!checkActive() || !isRootRun(context.snapshot)) return undefined;
					const runId = context.snapshot.runId;
					if (runId && runId === lastBeforeModelRunId) return undefined;
					if (runId) lastBeforeModelRunId = runId;
					runtime?.setTools(context.request.tools.map((tool) => tool.name));
					runtime?.next?.outgoing(context.request.messages);
				} catch (error) {
					log("beforeModel failed", error);
				}
				return undefined;
			},
			async afterRun(context) {
				if (!checkActive() || !runtime || !isRootRun(context.snapshot)) return;
				if (!runtime.next) {
					try {
						runtime.recordDormantTurn?.(context.result);
					} catch (error) {
						log("afterRun dormant turn failed", error);
					}
					return;
				}
				try {
					await runtime.next.afterRun(context.result);
				} catch (error) {
					log("afterRun failed", error);
				}
				const pushed = runtime.next.turn()?.pushed ?? false;
				runtime.connectors?.refresher
					.onTurn({ pushed })
					.catch((error: unknown) => log("a refresh failed", error));
			},
		},
		setup(rawApi, rawContext) {
			const api = (rawApi ?? {}) as UiSlotPluginApi;
			const context = (rawContext ?? {}) as UiSlotSetupContext;
			const sessionId = context.session?.sessionId ?? "";
			log = (message, error) =>
				context.logger?.debug(`[${PLUGIN_NAME}] ${message}`, { error });
			startError = undefined;
			lastBeforeModelRunId = undefined;
			wasActive = lifecycle.active();
			const active =
				options.startRuntime && !options.isNextActive
					? true
					: isActive(api, context);
			const pushToSlot = (payload: TrayPush) => {
				try {
					context.ui?.push("next.state", payload);
				} catch (error) {
					log("ui.push failed", error);
				}
			};
			let offSeq = 0;
			pushOff = () => {
				offSeq += 1;
				pushToSlot({
					sessionId,
					seq: (runtime?.next?.currentPush().seq ?? 0) + offSeq,
					state: "off",
				});
			};
			let subscribedNext: unknown;
			const bindNext = () => {
				const next = runtime?.next;
				if (!next || next === subscribedNext) return;
				subscribedNext = next;
				if (options.startRuntime && options.onSet)
					next.onSet(options.onSet(context));
				else if (options.startRuntime) next.onSet(logSet(context));
				next.onPush(pushToSlot);
			};
			try {
				runtime = start(context, { active });
				bindNext();
			} catch (error) {
				startError = error instanceof Error ? error.message : String(error);
				log("the runtime did not start", error);
			}
			if (typeof api.registerUiHandler === "function") {
				api.registerUiHandler("next", async (rawInput: unknown) => {
					const action = parseTrayAction(rawInput);
					if (!action) throw new Error("invalid NextTurnTrayAction");
					if (!checkActive()) {
						return { sessionId, seq: 0, state: "off" } satisfies TrayPush;
					}
					if (startError) {
						return {
							sessionId,
							seq: 0,
							state: "unavailable",
							error: startError,
						} satisfies TrayPush;
					}
					if (!runtime || !sessionId) {
						return { sessionId, seq: 0, state: "off" } satisfies TrayPush;
					}
					if (action.type === "current") {
						if (!runtime.next) {
							runtime.activateNext?.(action.client);
							bindNext();
						}
						if (!runtime.next)
							return { sessionId, seq: 0, state: "off" } satisfies TrayPush;
						if (typeof runtime.next.ensureCurrent === "function") {
							return await runtime.next.ensureCurrent(action.runCount);
						}
						return runtime.next.currentPush();
					}
					if (!runtime.next)
						return { sessionId, seq: 0, state: "off" } satisfies TrayPush;
					await runtime.next.invoke(action);
					return runtime.next.currentPush();
				});
			}
		},
	};
}
