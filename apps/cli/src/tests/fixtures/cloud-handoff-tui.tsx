import { writeFileSync } from "node:fs";
import { CoreSessionService, SqliteSessionStore } from "@cline/core";
import { renderOpenTui } from "../../tui";
import type { TuiProps } from "../../tui/types";
import type { Config } from "../../utils/types";

const statePath = process.env.CLOUD_HANDOFF_FIXTURE_STATE;
if (!statePath) throw new Error("CLOUD_HANDOFF_FIXTURE_STATE is required");
const dbDataDir = process.env.CLINE_DB_DATA_DIR;
if (!dbDataDir) throw new Error("CLINE_DB_DATA_DIR is required");
type FixtureState = {
	preparedDraft?: { instruction: string; images: string[] };
	preparedDrafts?: Array<{ instruction: string; images: string[] }>;
	retryTargets?: Array<{
		taskId: string;
		instruction: string;
		images: string[];
	}>;
	started?: boolean;
	localPrompts?: string[];
	activeSessionId?: string;
	resumeCalls?: string[];
	preparedSessionIds?: string[];
	completedTaskIds?: string[];
};
const state: FixtureState = {};
const record = <K extends keyof FixtureState>(
	key: K,
	value: FixtureState[K],
) => {
	state[key] = value;
	writeFileSync(statePath, JSON.stringify(state));
};

const cwd = process.cwd();
const providerId = process.env.CLOUD_HANDOFF_FIXTURE_PROVIDER ?? "cline";
let activeSessionId = "synthetic-session-a";
const sessionListeners = new Set<() => void>();
const setActiveSession = (sessionId: string) => {
	activeSessionId = sessionId;
	record("activeSessionId", sessionId);
	for (const listener of sessionListeners) listener();
};

// Seed only this fixture's isolated history database so /history exercises the
// real picker without reading or changing the user's history.
const history = new CoreSessionService(
	new SqliteSessionStore({
		sessionsDir: dbDataDir,
	}),
);
await history.createRootSessionWithArtifacts({
	sessionId: activeSessionId,
	source: "cli",
	pid: process.pid,
	interactive: true,
	provider: providerId,
	model: "synthetic-model",
	cwd: process.cwd(),
	workspaceRoot: process.cwd(),
	enableTools: true,
	enableSpawn: false,
	enableTeams: false,
	prompt: "Synthetic history session A",
	status: "completed",
	exitCode: 0,
});
const config: Config = {
	apiKey: "synthetic-test-key",
	systemPrompt: "",
	cwd,
	workspaceRoot: cwd,
	providerId,
	modelId: "synthetic-model",
	mode: "act",
	thinking: false,
	verbose: false,
	toolPolicies: { "*": { autoApprove: false } },
	knownModels: {},
	defaultToolAutoApprove: false,
	enableTools: true,
	enableSpawnAgent: false,
	enableAgentTeams: false,
	sandbox: false,
	outputMode: "text",
};
const noop = async () => undefined;
const props = {
	config,
	startupTarget: "chat",
	loadClineAccount: async () => {
		throw new Error("Synthetic fixture has no cloud account");
	},
	switchClineAccount: noop,
	loadConfigData: async () => ({
		workflows: [],
		rules: [],
		skills: [],
		hooks: [],
		agents: [],
		plugins: [],
		mcp: [],
		tools: [],
		workflowSlashCommands: [],
	}),
	subscribeToEvents: () => () => {},
	onSubmit: async (prompt: string) => {
		record("localPrompts", [...(state.localPrompts ?? []), prompt]);
		return {
			usage: { inputTokens: 0, outputTokens: 0 },
			iterations: 1,
		};
	},
	onUpdatePendingPrompt: async () => ({ sessionId: "synthetic", prompts: [] }),
	onAbort: () => false,
	onExit: () => {},
	onRunningChange: () => {},
	onTurnErrorReported: () => {},
	onAutoApproveChange: () => {},
	onCompactionModeChange: noop,
	onModelChange: noop,
	onModeChange: noop,
	onNewSession: async () => setActiveSession("synthetic-session-b"),
	onSessionRestart: noop,
	onAccountChange: noop,
	onResumeSession: async (sessionId: string) => {
		record("resumeCalls", [...(state.resumeCalls ?? []), sessionId]);
		setActiveSession(sessionId);
		return {
			messages: [
				{ role: "user", content: "Synthetic history conversation" },
				{ role: "assistant", content: "Synthetic history response" },
			],
		};
	},
	onExportHistorySession: async () => "",
	onDeleteHistorySession: async () => true,
	onCompact: async () => ({
		messagesBefore: 0,
		messagesAfter: 0,
		compacted: false,
	}),
	onFork: async () => undefined,
	getCheckpointData: async () => undefined,
	onRestoreCheckpoint: async () => undefined,
	setToolApprover: () => {},
	setAskQuestion: () => {},
	setModeChangeNotifier: () => {},
	cloudSessions: {
		listRepositories: async () => ({
			connected: false,
			connectUrl: "",
			repositories: [],
		}),
		listBranches: async () => ({ available: false, branches: [] }),
		listModels: async () => [],
		create: async () => {
			throw new Error("Not used by handoff fixture");
		},
		send: async () => {
			throw new Error("Not used by handoff fixture");
		},
		abort: async () => ({ sessionId: "synthetic", ok: true as const }),
		subscribe: () => () => {},
		getSnapshot: () => undefined,
	},
	activeSession: {
		getId: () => activeSessionId,
		subscribe: (listener: () => void) => {
			sessionListeners.add(listener);
			return () => sessionListeners.delete(listener);
		},
	},
	onPrepareCloudHandoff: async (draft: {
		instruction: string;
		images: string[];
	}) => {
		record("preparedDraft", draft);
		record("preparedDrafts", [...(state.preparedDrafts ?? []), draft]);
		record("preparedSessionIds", [
			...(state.preparedSessionIds ?? []),
			activeSessionId,
		]);
		if (
			process.env.CLOUD_HANDOFF_FIXTURE_REJECT_SECOND === "1" &&
			(state.preparedDrafts?.length ?? 0) === 2
		) {
			throw new Error("Synthetic second preparation rejected");
		}
		return {
			git: {
				id: "synthetic-plan",
				repoUrl: "https://github.com/example/synthetic-project",
				remote: "origin",
				branch: "qa/cloud-handoff-test",
				sourceBranch: "main",
				workspaceRelativePath: "",
				files: [{ path: "note.txt", status: "modified" }],
				commits: ["abc1234 synthetic local commit"],
			},
			start: async (
				onProgress: (progress: {
					message: string;
					dashboardUrl?: string;
				}) => void,
			) => {
				record("started", true);
				const target = {
					taskId: `synthetic-task-${state.preparedDrafts?.length ?? 1}`,
					instruction: draft.instruction,
					images: draft.images,
				};
				onProgress({ message: "Publishing the approved Git snapshot." });
				if (process.env.CLOUD_HANDOFF_FIXTURE_WITH_RETRY === "1") {
					await new Promise((resolve) => setTimeout(resolve, 100));
					return {
						dashboardUrl: `https://app.cline.bot/tasks/${target.taskId}`,
						retrySend: async () => {
							record("retryTargets", [...(state.retryTargets ?? []), target]);
							return {
								dashboardUrl: `https://app.cline.bot/tasks/${target.taskId}`,
							};
						},
					};
				}
				const delay = Number(process.env.CLOUD_HANDOFF_FIXTURE_DELAY_MS ?? 0);
				if (delay > 0) {
					await new Promise((resolve) => setTimeout(resolve, delay));
					record("completedTaskIds", [
						...(state.completedTaskIds ?? []),
						target.taskId,
					]);
					return {
						dashboardUrl: `https://app.cline.bot/tasks/${target.taskId}`,
					};
				}
				if (process.env.CLOUD_HANDOFF_FIXTURE_FAIL === "1") {
					await new Promise((resolve) => setTimeout(resolve, 1500));
					throw new Error(
						'CLOUD_SESSION_ERROR:{"code":"request_failed","message":"Synthetic publish failure"}',
					);
				}
				await new Promise((resolve) => setTimeout(resolve, 5000));
				onProgress({
					message: "Preparing the cloud workspace.",
					dashboardUrl: "https://app.cline.bot/tasks/synthetic-task",
				});
				await new Promise((resolve) => setTimeout(resolve, 2500));
				return { dashboardUrl: "https://app.cline.bot/tasks/synthetic-task" };
			},
		};
	},
} satisfies TuiProps;

const tui = await renderOpenTui(props);
process.on("SIGINT", () => tui.destroy());
