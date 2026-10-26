import { writeFileSync } from "node:fs";
import { renderOpenTui } from "../../tui";
import type { TuiProps } from "../../tui/types";
import type { Config } from "../../utils/types";

const statePath = process.env.CLOUD_HANDOFF_FIXTURE_STATE;
if (!statePath) throw new Error("CLOUD_HANDOFF_FIXTURE_STATE is required");
type FixtureState = {
	preparedDraft?: { instruction: string; images: string[] };
	started?: boolean;
	localPrompts?: string[];
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
const config: Config = {
	apiKey: "synthetic-test-key",
	systemPrompt: "",
	cwd,
	workspaceRoot: cwd,
	providerId: "anthropic",
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
	onNewSession: noop,
	onSessionRestart: noop,
	onAccountChange: noop,
	onResumeSession: async () => ({ messages: [] }),
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
	onPrepareCloudHandoff: async (draft: {
		instruction: string;
		images: string[];
	}) => {
		record("preparedDraft", draft);
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
				onProgress({ message: "Publishing the approved Git snapshot." });
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
