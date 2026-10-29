import { mock } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { CoreSessionService, SqliteSessionStore } from "@cline/core";
import type { CloudSessionSnapshot } from "@cline/core/cloud";
import { CloudSessionError } from "@cline/core/cloud";
import type { TuiProps } from "../../tui/types";
import type { Config } from "../../utils/types";
import type { FixtureState } from "./cloud-handoff-state";

const statePath = process.env.CLOUD_HANDOFF_FIXTURE_STATE;
if (!statePath) throw new Error("CLOUD_HANDOFF_FIXTURE_STATE is required");
const dbDataDir = process.env.CLINE_DB_DATA_DIR;
if (!dbDataDir) throw new Error("CLINE_DB_DATA_DIR is required");
const state: FixtureState = {};
const record = <K extends keyof FixtureState>(
	key: K,
	value: FixtureState[K],
) => {
	state[key] = value;
	writeFileSync(statePath, JSON.stringify(state));
};

mock.module("../../utils/open", () => ({
	default: async (target: string | URL) => {
		record("openedUrls", [...(state.openedUrls ?? []), String(target)]);
	},
}));

const scenario = process.env.CLOUD_HANDOFF_FIXTURE_SCENARIO ?? "success";
async function waitForRelease() {
	const releasePath = process.env.CLOUD_HANDOFF_FIXTURE_RELEASE;
	if (!releasePath)
		throw new Error("CLOUD_HANDOFF_FIXTURE_RELEASE is required");
	const deadline = Date.now() + 20_000;
	while (!existsSync(releasePath)) {
		if (Date.now() >= deadline)
			throw new Error(
				"Timed out waiting for the test to release the cloud handoff",
			);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

const cwd = process.cwd();
const providerId = process.env.CLOUD_HANDOFF_FIXTURE_PROVIDER ?? "cline";
const cloudSessionId = "synthetic-cloud-session-1";
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
	loadClineAccount: async () => ({
		user: {
			id: "synthetic-user",
			email: "synthetic@example.com",
			displayName: "Synthetic User",
			photoUrl: "",
			createdAt: "",
			updatedAt: "",
			organizations: [],
		},
		balance: { balance: 0, userId: "synthetic-user" },
		organizationBalance: null,
		organizations: [],
		activeOrganization: null,
		displayedBalance: 0,
	}),
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
		scope: { serviceId: "synthetic-cloud-service", scopeGeneration: 1 },
		attach: async (sessionId: string) => {
			if (scenario === "attach-failure")
				throw new Error("Synthetic attach failure");
			record("attachedSessions", [
				...(state.attachedSessions ?? []),
				sessionId,
			]);
			return {
				sessionId,
				status: "running",
				model: "synthetic-cloud-model",
				repoUrl: "https://github.com/example/synthetic-project",
				branch: "main",
			};
		},
		listRepositories: async () => ({
			connected: true,
			connectUrl: "",
			repositories: [
				{
					id: 1,
					name: "synthetic-project",
					fullName: "example/synthetic-project",
					url: "https://github.com/example/synthetic-project",
					defaultBranch: "main",
				},
			],
		}),
		listBranches: async () => ({ available: false, branches: [] }),
		listModels: async () => [],
		create: async () => {
			throw new Error("Not used by handoff fixture");
		},
		send: async (sessionId: string, prompt: string, _delivery, modelId) => {
			record("cloudSends", [
				...(state.cloudSends ?? []),
				{ sessionId, modelId: modelId ?? "", prompt },
			]);
			return { sessionId, ok: true as const };
		},
		abort: async () => ({ sessionId: "synthetic", ok: true as const }),
		subscribe: () => () => {},
		getSnapshot: (sessionId: string): CloudSessionSnapshot | undefined =>
			sessionId === cloudSessionId
				? {
						sessionId,
						config: { modelId: "synthetic-cloud-model" },
						messages: [
							{
								role: "assistant",
								content: "Synthetic attached cloud transcript",
							},
						],
						promptsInQueue: [],
						busy: false,
						startedAt: 0,
						status: "running",
						approvals:
							scenario === "approval"
								? [
										{
											requestId: "synthetic-request",
											sessionId,
											approvalId: "synthetic-approval",
											createdAt: "2026-01-01T00:00:00.000Z",
											toolCallId: "synthetic-tool-call",
											toolName: "write_to_file",
										},
									]
								: [],
						connectionState: "connected",
						transcriptKnown: true,
						record: {
							id: sessionId,
							status: "running",
							sandboxUrl: "https://synthetic.example.test",
							repoContext: {
								repoUrl: "https://github.com/example/synthetic-project",
								branch: "main",
							},
							metadata: { modelId: "synthetic-cloud-model" },
							createdAt: "2026-01-01T00:00:00.000Z",
							updatedAt: "2026-01-01T00:00:00.000Z",
						},
					}
				: undefined,
	},
	activeSession: {
		getId: () => activeSessionId,
		subscribe: (listener: () => void) => {
			sessionListeners.add(listener);
			return () => sessionListeners.delete(listener);
		},
	},
	onPrepareCloudHandoff: async (draft) => {
		if (scenario === "github-disconnected") {
			throw new Error(
				new CloudSessionError(
					"github_not_connected",
					"Connect GitHub before handing this session off to cloud.",
					"https://app.cline.bot/settings/integrations",
				).message,
			);
		}
		record("preparations", [
			...(state.preparations ?? []),
			{ sessionId: activeSessionId, draft },
		]);
		if (scenario === "retry" && state.preparations?.length === 2) {
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
			start: async (onProgress) => {
				record("started", true);
				const target = {
					taskId: `synthetic-task-${state.preparations?.length ?? 1}`,
					instruction: draft.instruction,
					images: draft.images,
				};
				onProgress({ message: "Publishing the approved Git snapshot." });
				if (scenario === "retry") {
					return {
						sessionId: cloudSessionId,
						dashboardUrl: `https://app.cline.bot/tasks/${target.taskId}`,
						retrySend: async () => {
							record("retryTargets", [...(state.retryTargets ?? []), target]);
							return {
								sessionId: cloudSessionId,
								dashboardUrl: `https://app.cline.bot/tasks/${target.taskId}`,
							};
						},
					};
				}
				if (scenario === "held-success" || scenario === "held-failure") {
					await waitForRelease();
				}
				if (scenario === "failure" || scenario === "held-failure") {
					throw new Error(
						'CLOUD_SESSION_ERROR:{"code":"request_failed","message":"Synthetic publish failure"}',
					);
				}
				record("completedTaskIds", [
					...(state.completedTaskIds ?? []),
					target.taskId,
				]);
				const dashboardUrl = `https://app.cline.bot/tasks/${target.taskId}`;
				if (scenario === "warning") {
					return {
						sessionId: cloudSessionId,
						dashboardUrl,
						warning: "Synthetic cloud send warning",
						retrySend: async () => {
							record("retryTargets", [...(state.retryTargets ?? []), target]);
							return { sessionId: cloudSessionId, dashboardUrl };
						},
					};
				}
				onProgress({
					message: "Preparing the cloud workspace.",
					dashboardUrl,
				});
				return { sessionId: cloudSessionId, dashboardUrl };
			},
		};
	},
} satisfies TuiProps;

const { renderOpenTui } = await import("../../tui");
const tui = await renderOpenTui(props);
process.on("SIGINT", () => tui.destroy());
