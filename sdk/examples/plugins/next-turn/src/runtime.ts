import type { AgentPlugin } from "@cline/core";
import type { AgentRunResult, PluginUiSurface } from "@cline/shared";
import { clineConnectionLoaders } from "./connectors/cline-connections";
import { GhReader } from "./connectors/github/gh";
import { Connectors } from "./connectors/index";
import { clineMcpRunnerDeps } from "./connectors/pinned/runners";
import type { ContextSource, SourceEnv } from "./context/source";
import { clineSources } from "./context/sources/index";
import { dirtyFileCounter } from "./context/sources/workspace";
import { NextTurnEngine } from "./engine/engine";
import { NotifyGate } from "./engine/notify";
import { CursorWriter } from "./hub/fold/cursor";
import { HubLink, type HubLinkDeps } from "./hub/link";
import { nodeHubLinkDeps } from "./hub/node-deps";
import { pluginLog } from "./log";
import { backlogReader, type PlanAdapter } from "./planner/backlog";
import { LabelLog } from "./planner/labels/labels";
import {
	captureLabel,
	clientSurfaceOf,
	legacySurfaceOf,
	surfaceOf,
} from "./planner/labels/telemetry";
import { PlannerLedger } from "./planner/model/allowance";
import { clineCompleter, plannerProvider } from "./planner/model/model";
import { NextSession } from "./planner/session/session";
import type { MessageLike } from "./planner/turn/run-count";
import { deriveTurn } from "./planner/turn/turn";
import { type RunCommand, runCommand } from "./run";
import type { Settings } from "./settings/settings";
import { nextTurnPaths } from "./store/data-dir";
import {
	FileSessionStateStore,
	pruneSessionStates,
	updateSessionState,
} from "./store/session-state";
import { isRecord, listOf, text } from "./values";

export type SetupContext = Parameters<NonNullable<AgentPlugin["setup"]>>[1];

/**
 * One chat's Next Turn, built in the sandbox's `setup`: the hub
 * link and its fold, the Cline-first sources and the person's connectors, and
 * Next. The run hooks reach it through the plugin object.
 */
export type SessionRuntime = {
	next?: NextSession;
	connectors?: Connectors;
	/**
	 * Whether a viewer is attached. Viewed, a dormant chat starts
	 * `NextSession`, `clineSources` and `Connectors`, and the connector
	 * refresher runs; unviewed, the refresher stops and turns are only
	 * recorded. While the plugin is disabled a viewer is only remembered, and
	 * Next starts at the first turn after it is enabled again. A surface is
	 * remembered past a detach; without one the remembered surface stays.
	 */
	setViewed(
		viewed: boolean,
		surface?: PluginUiSurface,
	): NextSession | undefined;
	/** True while a viewer is attached, and always on a session that never waits for one. */
	viewed(): boolean;
	/** Records the last turn even while `next` is dormant. */
	recordDormantTurn(result: AgentRunResult): void;
	/** The agent's tools this turn, from `beforeModel`: a capability source. */
	setTools(names: readonly string[]): void;
	stop(): void | Promise<void>;
};

type RuntimeOptions = {
	settings: () => Settings;
	/** Whether the session never waits for a viewer, so Next starts at setup (false: dormant until a viewer attaches). */
	active: boolean;
	/** Whether the plugin is still enabled and installed; a disabled plugin sends no notifications. */
	pluginActive?: () => boolean;
	/** Optional host-supplied plan and bank adapter. */
	plan?: PlanAdapter & { source?: () => ContextSource };
	/** How the hub link finds and reaches a running hub; tests replace it. */
	hubLink?: HubLinkDeps;
	/** The read-only `gh` and `git` runner; tests replace it. */
	runCommand?: RunCommand;
};

type SessionEnvInputs = {
	/** The agent's tools as `beforeModel` last saw them. */
	tools: () => readonly string[];
	/** Branch and commit as git last reported them, over the setup context's. */
	git?: () => { branch?: string; commit?: string } | undefined;
	/** The chat's provider: a connector's Read holds only while the planner sends to it. */
	chatProviderId?: () => string | undefined;
};

/** The session's environment from the setup context and what the session learned since. */
export function sessionEnv(
	context: SetupContext,
	{ tools, git, chatProviderId }: SessionEnvInputs,
): () => SourceEnv {
	const info = context.workspaceInfo;
	return () => {
		const liveGit = git?.();
		const branch = liveGit?.branch ?? info?.latestGitBranchName;
		const commit = liveGit?.commit ?? info?.latestGitCommitHash;
		const providerId = chatProviderId?.();
		return {
			client: context.client?.name,
			sessionId: context.session?.sessionId,
			...(providerId ? { providerId } : {}),
			workspaceRoot: info?.rootPath,
			...(branch || commit
				? { git: { branch, commit, remotes: info?.associatedRemoteUrls ?? [] } }
				: {}),
			tools: [...tools()],
		};
	};
}

/** The session's transcript and status from the hub, for a viewer of a chat with no turn in memory. */
async function hubTranscript(
	link: Pick<HubLink, "command">,
	sessionId: string,
): Promise<{ messages: MessageLike[]; status?: string }> {
	const [messagesReply, sessionReply] = await Promise.all([
		link.command("session.messages", { sessionId }).catch(() => undefined),
		link.command("session.get", { sessionId }).catch(() => undefined),
	]);
	return {
		messages: listOf(messagesReply, "messages"),
		status: text(
			isRecord(sessionReply?.session) ? sessionReply.session.status : undefined,
		),
	};
}

/**
 * Starts the session's runtime, or returns nothing when the session is not
 * known or no feature needs it. It never starts a hub. Next needs
 * `features.next`; the engine alone also serves Needs-you notifications.
 */
export function startSessionRuntime(
	context: SetupContext,
	options: RuntimeOptions,
): SessionRuntime | undefined {
	const sessionId = context.session?.sessionId;
	const { settings } = options;
	const current = settings();
	if (!sessionId || (!current.features.next && !current.notify.needsYou))
		return undefined;
	const workspaceRoot = context.workspaceInfo?.rootPath;
	const scope = { workspaceRoot };
	const log = pluginLog(context);
	const pluginActive = () => options.pluginActive?.() ?? true;
	const run = options.runCommand ?? runCommand;
	const link = new HubLink(
		{
			...(options.hubLink ?? nodeHubLinkDeps()),
			log: (message, error) => log(message, error),
		},
		{
		workspaceRoot,
		cwd: workspaceRoot,
	});
	const paths = nextTurnPaths();
	const engine = new NextTurnEngine({
		link,
		scope,
		sessionId,
		cursor: new CursorWriter(paths.cursor),
		notify: new NotifyGate({
			enabled: () => pluginActive() && settings().notify.needsYou,
		}),
		log,
	});
	engine.start().catch((error: unknown) => log("the hub link stopped", error));
	void pruneSessionStates(paths.sessions);
	const store = new FileSessionStateStore(
		paths.sessions,
		sessionId,
		Date.now,
		(message, error) => log(message, error),
	);
	const saved = store.read();
	/** The last viewer's surface, kept past its detach so labels still name the tray it used. */
	let rememberedSurface: PluginUiSurface | undefined =
		saved?.viewerSurface ??
		(saved?.viewerClient
			? (clientSurfaceOf(saved.viewerClient) ?? "other")
			: undefined);
	let viewedFlag = options.active || Boolean(rememberedSurface);
	/** The store keeps the surface only while a viewer is attached, so an unviewed chat's respawn waits for one. */
	const persistedSurface = () => (viewedFlag ? rememberedSurface : undefined);
	const persistViewer = () => {
		const surface = persistedSurface();
		const stored = store.read();
		if (stored?.viewerSurface === surface && stored?.viewerClient === undefined)
			return;
		updateSessionState(store, {
			viewerSurface: surface,
			viewerClient: undefined,
		});
	};
	if (saved?.viewerClient !== undefined) persistViewer();
	let tools: readonly string[] = [];
	let gitState: { branch?: string; commit?: string } | undefined;
	const env = sessionEnv(context, {
		tools: () => tools,
		git: () => gitState,
		chatProviderId: () => runtime.next?.chat()?.providerId,
	});
	const stops: Array<() => void> = [];
	let stopped = false;
	const activateNext = (): NextSession | undefined => {
		if (runtime.next) return runtime.next;
		if (!settings().features.next) return undefined;
		const cline = clineSources(link, () => engine.fold(), scope, log, {
			plan: Boolean(options.plan),
			planSource: options.plan?.source?.(),
		});
		stops.push(() => cline.stop());
		const connectors = new Connectors({
			loaders: clineConnectionLoaders(link),
			gh: new GhReader(run),
			mcp: clineMcpRunnerDeps(),
			settings,
			env,
			active: pluginActive,
			log,
		});
		void connectors
			.detect()
			.catch((error: unknown) => log("connector detection failed", error))
			.then(() => {
				if (!stopped && pluginActive() && viewedFlag)
					return connectors.refresher.start();
			})
			.catch((error: unknown) => log("the refresher stopped", error));
		stops.push(() => connectors.refresher.stop());
		const next: NextSession = new NextSession({
			sessionId,
			settings,
			env,
			sources: () => [...cline.sources, ...connectors.all()],
			backlog: backlogReader({
				sessionId,
				fold: () => engine.fold(),
				scope,
				plan: options.plan,
			}),
			dirtyFiles: dirtyFileCounter(run, (snapshot) => {
				gitState = {
					branch: snapshot.branch ?? gitState?.branch,
					commit: snapshot.commit ?? gitState?.commit,
				};
			}),
			github: (turnEnv) => connectors.github.ciEvidence(turnEnv),
			complete: clineCompleter({
				choice: (planned) => plannerProvider(planned, next.chat()),
				requestContext: () => ({ sessionId, client: context.client }),
			}),
			ledger: new PlannerLedger(paths.plannerLedger),
			labels: new LabelLog(paths.labels, (record) =>
				captureLabel(
					context.telemetry,
					rememberedSurface
						? surfaceOf(rememberedSurface)
						: legacySurfaceOf(context.client?.name),
					record,
				),
			),
			store,
			viewerSurface: persistedSurface,
			viewed: () => viewedFlag,
			active: pluginActive,
			readTranscript: () => hubTranscript(link, sessionId),
			log,
		});
		runtime.next = next;
		runtime.connectors = connectors;
		return next;
	};
	const runtime: SessionRuntime = {
		setViewed: (viewed, surface) => {
			if (surface) rememberedSurface = surface;
			const wasViewed = viewedFlag;
			viewedFlag = viewed;
			persistViewer();
			const connectors = runtime.connectors;
			if (!viewed) {
				connectors?.refresher.stop();
				return runtime.next;
			}
			if (!pluginActive()) return runtime.next;
			if (!wasViewed && connectors && !stopped)
				void connectors.refresher
					.start()
					.catch((error: unknown) => log("the refresher stopped", error));
			return activateNext();
		},
		viewed: () => viewedFlag,
		recordDormantTurn: (result) => {
			const derived = deriveTurn(sessionId, result);
			if (!derived) return;
			updateSessionState(store, {
				viewerSurface: persistedSurface(),
				lastTurn: derived,
				...(derived.chat ? { lastChat: derived.chat } : {}),
				turnState: undefined,
				lastPush: undefined,
			});
		},
		setTools: (names) => {
			tools = names;
		},
		stop: async () => {
			stopped = true;
			runtime.next?.dispose();
			for (const stop of stops) stop();
			await engine.dispose();
		},
	};
	if (!current.features.next) return runtime;
	if (!viewedFlag) {
		log("Next is dormant until a viewer attaches", {
			client: context.client?.name,
		});
		return runtime;
	}
	activateNext();
	return runtime;
}
