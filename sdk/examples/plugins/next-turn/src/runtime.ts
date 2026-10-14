import type { AgentPlugin } from "@cline/core";
import type { AgentRunResult } from "@cline/shared";
import { PLUGIN_NAME } from "./config";
import { clineConnectionLoaders } from "./connectors/cline-connections";
import { GhReader } from "./connectors/github/gh";
import { Connectors } from "./connectors/index";
import { runCommand } from "./connectors/run";
import { clineMcpRunnerDeps, composioRunner } from "./connectors/runners";
import type { ContextSource, SourceEnv } from "./context/source";
import { clineSources } from "./context/sources/index";
import { dirtyFileCounter } from "./context/sources/workspace";
import { PlannerLedger } from "./engine/allowance";
import { NextTurnEngine } from "./engine/engine";
import { NotifyGate } from "./engine/notify";
import { HubLink, nodeHubLinkDeps } from "./hub/link";
import { backlogReader, type PlanAdapter } from "./planner/backlog";
import { LabelLog } from "./planner/labels";
import { clineCompleter, plannerProvider } from "./planner/model";
import { NextSession, type OfferedSet } from "./planner/next";
import { captureLabel, surfaceOf } from "./planner/telemetry";
import type { MessageLike, Turn } from "./planner/turn";
import { deriveTurn } from "./planner/turn";
import type { Settings } from "./settings/settings";
import { nextTurnPaths, resolveClineDataDir } from "./store/data-dir";
import {
	FileSessionStateStore,
	pruneSessionStates,
} from "./store/session-state";

export type SetupContext = Parameters<NonNullable<AgentPlugin["setup"]>>[1];

/**
 * One chat's Next Turn, built in the sandbox's `setup`: the hub
 * link and its fold, the Cline-first sources and the person's connectors, and
 * Next. The run hooks reach it through the plugin object.
 */
export type SessionRuntime = {
	engine: NextTurnEngine;
	next?: NextSession;
	connectors?: Connectors;
	/** Starts `NextSession`, `clineSources` and `Connectors` when a dormant session is viewed (`current` invoke). */
	activateNext?(viewerClient?: string): NextSession | undefined;
	/** Records the last turn even while `next` is dormant. */
	recordDormantTurn?(result: AgentRunResult): void;
	/** The most recently derived turn in this session. */
	lastTurn?(): Turn | undefined;
	/** The agent's tools this turn, from `beforeModel`: a capability source. */
	setTools(names: readonly string[]): void;
	stop(): void;
};

export type RuntimeOptions = {
	settings: () => Settings;
	/** Where served sets go until the UI slot gives them a tray. */
	onSet?: (set: OfferedSet | undefined) => void;
	/** Whether Next starts immediately at setup time (true on desktop with UI slots, false when dormant until viewed). */
	active?: boolean;
	/** Optional host-supplied plan and bank adapter. */
	plan?: PlanAdapter & { source?: () => ContextSource };
	env?: NodeJS.ProcessEnv;
};

/** The session's environment from the setup context, plus the agent's tools as `beforeModel` last saw them. */
export function sessionEnv(
	context: SetupContext,
	tools: () => readonly string[],
	viewerClient?: () => string | undefined,
	gitOverride?: () => { branch?: string; commit?: string } | undefined,
): () => SourceEnv {
	const info = context.workspaceInfo;
	return () => {
		const liveGit = gitOverride?.();
		const branch = liveGit?.branch ?? info?.latestGitBranchName;
		const commit = liveGit?.commit ?? info?.latestGitCommitHash;
		return {
			client: viewerClient?.() ?? context.client?.name,
			sessionId: context.session?.sessionId,
			workspaceRoot: info?.rootPath,
			cwd: info?.rootPath,
			...(branch || commit
				? { git: { branch, commit, remotes: info?.associatedRemoteUrls ?? [] } }
				: {}),
			tools: [...tools()],
		};
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
	const log = (message: string, error?: unknown) =>
		context.logger?.debug(`[${PLUGIN_NAME}] ${message}`, { sessionId, error });
	const link = new HubLink(nodeHubLinkDeps(), {
		workspaceRoot,
		cwd: workspaceRoot,
	});
	const engine = new NextTurnEngine({
		link,
		scope,
		sessionId,
		notify: {
			enabled: () => settings().notify.needsYou,
			gate: new NotifyGate(),
		},
		log,
	});
	engine.start().catch((error: unknown) => log("the hub link stopped", error));
	let tools: readonly string[] = [];
	const paths = nextTurnPaths(resolveClineDataDir(options.env));
	pruneSessionStates(paths.sessions);
	const store = new FileSessionStateStore(paths.sessions, sessionId);
	const savedState = store.read();
	let clientOverride: string | undefined = savedState?.viewerClient;
	let gitState: { branch?: string; commit?: string } | undefined;
	let dormantTurn: Turn | undefined = savedState?.lastTurn;
	const env = sessionEnv(
		context,
		() => tools,
		() => clientOverride,
		() => gitState,
	);
	const stops: Array<() => void> = [];
	const activateNext = (viewerClient?: string): NextSession | undefined => {
		if (viewerClient) clientOverride = viewerClient;
		if (runtime.next) return runtime.next;
		if (!settings().features.next) return undefined;
		const cline = clineSources(link, () => engine.fold(), scope, log, {
			plan: Boolean(options.plan),
			planSource: options.plan?.source?.(),
		});
		stops.push(() => cline.stop());
		const connectors = new Connectors({
			loaders: clineConnectionLoaders(link),
			gh: new GhReader(runCommand),
			composio: composioRunner(),
			mcp: clineMcpRunnerDeps(),
			settings,
			env,
			log,
		});
		void connectors
			.detect()
			.catch((error: unknown) => log("connector detection failed", error))
			.then(() => connectors.refresher.start())
			.catch((error: unknown) => log("the refresher stopped", error));
		stops.push(() => connectors.refresher.stop());
		const next: NextSession = new NextSession(
			{
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
				dirtyFiles: dirtyFileCounter(runCommand, (snapshot) => {
					gitState = {
						branch: snapshot.branch ?? gitState?.branch,
						commit: snapshot.commit ?? gitState?.commit,
					};
				}),
				github: (turnEnv) => connectors.github.ciEvidence(turnEnv),
				complete: clineCompleter(
					() => plannerProvider(settings(), next.chat()),
					undefined,
					{
						sessionId,
						client: {
							...context.client,
							...(clientOverride ? { name: clientOverride } : {}),
						},
					},
				),
				ledger: new PlannerLedger(paths.plannerLedger),
				labels: new LabelLog(paths.labels, (record) =>
					captureLabel(
						context.telemetry,
						surfaceOf(clientOverride ?? context.client?.name),
						record,
					),
				),
				store,
				viewerClient: () => clientOverride,
				readTranscript: async () => {
					const [msgsReply, getReply] = await Promise.all([
						link
							.command("session.messages", { sessionId })
							.catch(() => undefined),
						link.command("session.get", { sessionId }).catch(() => undefined),
					]);
					const messages = Array.isArray(msgsReply?.messages)
						? (msgsReply.messages as MessageLike[])
						: [];
					const sessionObj = getReply?.session as
						| { status?: unknown }
						| undefined;
					const status =
						typeof sessionObj?.status === "string"
							? sessionObj.status
							: undefined;
					return { messages, ...(status ? { status } : {}) };
				},
				log,
			},
			dormantTurn,
		);
		if (options.onSet) stops.push(next.onSet(options.onSet));
		runtime.next = next;
		runtime.connectors = connectors;
		return next;
	};
	const runtime: SessionRuntime = {
		engine,
		activateNext,
		recordDormantTurn: (result) => {
			const derived = deriveTurn(sessionId, result);
			if (derived) {
				dormantTurn = derived;
				store.write({
					...(clientOverride ? { viewerClient: clientOverride } : {}),
					seq: savedState?.seq ?? 0,
					lastTurn: derived,
					...(derived.chat ? { lastChat: derived.chat } : {}),
				});
			}
		},
		lastTurn: () => runtime.next?.turn() ?? dormantTurn,
		setTools: (names) => {
			tools = names;
		},
		stop: () => {
			for (const stop of stops) stop();
		},
	};
	if (!current.features.next) return runtime;
	if (options.active === false && !savedState?.viewerClient) {
		log("Next is dormant until a viewer attaches", {
			client: context.client?.name,
		});
		return runtime;
	}
	activateNext();
	return runtime;
}
