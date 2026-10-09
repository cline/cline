import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import type { ClineCoreStartInput, ToolPolicy } from "@cline/core";
import type {
	LoadedSessionReplayBundle,
	LoadedSessionReplaySession,
	SessionReplayRebuiltWorkspace,
	SessionReplayRecordedEnvironment,
	SessionReplayRerunApprovalPrompt,
	SessionReplayRerunProgress,
	SessionReplayRerunReport,
} from "@cline/session";
import type { ToolApprovalResult } from "@cline/shared";
import { version as cliVersion } from "../../package.json";
import {
	CLI_DEFAULT_CHECKPOINT_CONFIG,
	CLI_DEFAULT_LOOP_DETECTION,
} from "../runtime/defaults";
import {
	describeCountedKinds,
	formatSessionDivergenceBody,
	plural,
} from "./diff";

/** A rerun option or bundle problem the user can fix; exits 2 without a stack. */
export class SessionRerunError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SessionRerunError";
	}
}

export interface SessionRerunInput {
	bundleDir: string;
	/** Bundle session to rerun; only the root session can be rerun. */
	sessionId?: string;
	/** Repository or workspace to restore from instead of the recorded root. */
	workspace?: string;
	inPlace?: boolean;
	/** Clone without borrowing the source's objects (for a container). */
	standalone?: boolean;
	untilDivergence?: boolean;
	ignore?: string;
	count?: string;
	lenient?: boolean;
	/** Ask for approvals and questions instead of answering from the recording. */
	interactive?: boolean;
	model?: string;
	provider?: string;
	/** Directory for the workspace copy, the rerun bundle and the report. */
	outDir?: string;
	/** Entries `outDir` may already hold, such as the bundle imported for this rerun. */
	outDirEntries?: readonly string[];
	onProgress?: (progress: SessionReplayRerunProgress) => void;
	/** Workspace and setup notes, before the session starts. */
	onNote?: (note: string) => void;
	signal?: AbortSignal;
}

export interface SessionRerunOutcome {
	report: SessionReplayRerunReport;
	reportPath: string;
	outDir: string;
}

/** Where a rerun writes by default: a sibling of the bundle. */
export function defaultRerunOutDir(
	bundleDir: string,
	now = new Date(),
): string {
	const stamp = now
		.toISOString()
		.replace(/\.\d+Z$/, "Z")
		.replace(/[-:]/g, "");
	return join(
		dirname(resolve(bundleDir)),
		`${basename(resolve(bundleDir))}.rerun-${stamp}`,
	);
}

export async function assertEmptyOutDir(
	outDir: string,
	allowed: readonly string[] = [],
): Promise<void> {
	if (!existsSync(outDir)) return;
	const entries = await readdir(outDir).catch(() => null);
	if (entries === null) {
		throw new SessionRerunError(`${outDir} exists and is not a directory.`);
	}
	if (entries.some((entry) => !allowed.includes(entry))) {
		throw new SessionRerunError(
			`${outDir} already exists and is not empty; pass --out <dir> to write the rerun elsewhere.`,
		);
	}
}

export function rootSessionOf(
	bundle: LoadedSessionReplayBundle,
	sessionId: string | undefined,
): LoadedSessionReplaySession {
	const rootId = bundle.manifest.rootSessionId;
	if (sessionId && sessionId !== rootId) {
		const known = bundle.sessions.some(
			(session) => session.entry.sessionId === sessionId,
		);
		throw new SessionRerunError(
			known
				? `Session ${sessionId} is a subagent session; a rerun starts from the bundle's root session ${rootId}.`
				: `Session ${sessionId} is not in the bundle. Its root session is ${rootId}.`,
		);
	}
	const root = bundle.sessions.find(
		(session) => session.entry.sessionId === rootId,
	);
	if (!root) {
		throw new SessionRerunError(
			`Bundle ${bundle.dir} has no root session ${rootId}.`,
		);
	}
	return root;
}

/**
 * The recorded tool policies, unless missing or redacted; then the CLI
 * default (everything auto-approved), as for `cline <prompt>`.
 */
export function rerunToolPolicies(
	environment: Pick<SessionReplayRecordedEnvironment, "toolPolicies">,
): { policies: Record<string, ToolPolicy>; recorded: boolean } {
	const recorded = environment.toolPolicies;
	if (
		recorded &&
		Object.keys(recorded).length > 0 &&
		!JSON.stringify(recorded).includes("REDACTED")
	) {
		return {
			policies: recorded as Record<string, ToolPolicy>,
			recorded: true,
		};
	}
	return { policies: { "*": { autoApprove: true } }, recorded: false };
}

/** Recorded `ask_question` answers, in the order they were given. */
export function recordedQuestionAnswers(
	iterations: ReadonlyArray<{
		toolCalls: ReadonlyArray<{ id: string; name: string }>;
		toolResults: ReadonlyArray<{
			toolCallId: string;
			content: unknown;
			text: string;
		}>;
	}>,
): string[] {
	const answers: string[] = [];
	for (const iteration of iterations) {
		for (const call of iteration.toolCalls) {
			if (call.name !== "ask_question") continue;
			const result = iteration.toolResults.find(
				(candidate) => candidate.toolCallId === call.id,
			);
			if (!result) continue;
			answers.push(
				typeof result.content === "string" ? result.content : result.text,
			);
		}
	}
	return answers;
}

async function askOnTerminal(question: string): Promise<string> {
	const rl = createInterface({ input: process.stdin, output: process.stderr });
	try {
		return await rl.question(question);
	} finally {
		rl.close();
	}
}

/** `--interactive` approvals: asks, offering the recorded answer as the default. */
async function askRerunApproval(
	prompt: SessionReplayRerunApprovalPrompt,
): Promise<ToolApprovalResult> {
	const input = JSON.stringify(prompt.request.input);
	const recorded = prompt.recorded
		? prompt.recorded.approved
			? "approved"
			: "denied"
		: "no recorded answer";
	const answer = (
		await askOnTerminal(
			`\nApprove ${prompt.request.toolName} ${input.length > 160 ? `${input.slice(0, 157)}...` : input}? (recorded: ${recorded}) [y/n, enter = ${prompt.recorded ? "recorded" : "n"}] `,
		)
	)
		.trim()
		.toLowerCase();
	const approved =
		answer === ""
			? prompt.recorded?.approved === true
			: answer === "y" || answer === "yes";
	return approved
		? { approved: true }
		: {
				approved: false,
				reason:
					answer === "" && prompt.recorded?.reason
						? prompt.recorded.reason
						: "Denied during replay rerun.",
			};
}

async function resolveProviderApiKeyFromEnv(
	provider: string,
): Promise<string | undefined> {
	const { Llms } = await import("@cline/core");
	const envKeys =
		(await Llms.getProviderCollection(provider))?.provider?.env ?? [];
	for (const envKey of envKeys) {
		const value = process.env[envKey]?.trim();
		if (value) return value;
	}
	return undefined;
}

interface RerunModel {
	provider: string;
	model: string;
	apiKey: string;
	reasoning: { thinking?: boolean; reasoningEffort?: string };
}

async function resolveRerunModel(input: {
	entry: LoadedSessionReplaySession["entry"];
	provider?: string;
	model?: string;
}): Promise<RerunModel> {
	const { ProviderSettingsManager } = await import("@cline/core");
	const { getPersistedProviderApiKey, normalizeProviderId } = await import(
		"../commands/auth"
	);
	const { resolveCliReasoning } = await import("../utils/reasoning");
	const provider = normalizeProviderId(
		input.provider?.trim() || input.entry.provider || "cline",
	);
	const settings = new ProviderSettingsManager().getProviderSettings(provider);
	const apiKey =
		getPersistedProviderApiKey(provider, settings) ||
		(await resolveProviderApiKeyFromEnv(provider)) ||
		"";
	const model =
		input.model?.trim() ||
		(input.provider?.trim() && provider !== input.entry.provider
			? settings?.model
			: undefined) ||
		input.entry.model ||
		settings?.model;
	if (!model) {
		throw new SessionRerunError(
			`The bundle does not name a model for provider ${provider}; pass --model <id>.`,
		);
	}
	const reasoning = resolveCliReasoning({
		thinking: false,
		thinkingExplicitlySet: false,
		persistedReasoning: settings?.reasoning,
	});
	return { provider, model, apiKey, reasoning };
}

function shortRef(ref: string): string {
	return ref.slice(0, 12);
}

export function describeRebuiltWorkspace(
	workspace: Pick<
		SessionReplayRebuiltWorkspace,
		"method" | "source" | "root"
	> & {
		checkpoint?: { ref: string; kind: "stash" | "commit" };
	},
): string {
	switch (workspace.method) {
		case "checkpoint":
			return `checkpoint ${shortRef(workspace.checkpoint?.ref ?? "")} (${workspace.checkpoint?.kind}) restored into ${workspace.root}, a fresh clone of ${workspace.source}`;
		case "copy":
			return `${workspace.source} copied as it is to ${workspace.root} (no checkpoint)`;
		default:
			return `${workspace.root}, in place`;
	}
}

/**
 * Runs a bundle's root session again in a rebuilt workspace and writes the
 * divergence report. The rerun runs on the hub with recording on, so it is a
 * new session that is exported as a bundle next to the report.
 */
export async function runSessionRerun(
	input: SessionRerunInput,
): Promise<SessionRerunOutcome> {
	const replay = await import("@cline/session");
	const { createSessionId } = await import("@cline/shared");
	const bundleDir = resolve(input.bundleDir);

	let kinds: ReturnType<typeof replay.resolveSessionReplayRerunKinds>;
	try {
		kinds = replay.resolveSessionReplayRerunKinds({
			ignore: input.ignore,
			count: input.count,
			lenient: input.lenient,
			modelOverride: Boolean(input.model?.trim() || input.provider?.trim()),
		});
	} catch (error) {
		throw new SessionRerunError(
			error instanceof Error ? error.message : String(error),
		);
	}

	const bundle = await replay.readSessionReplayBundle(bundleDir);
	const session = rootSessionOf(bundle, input.sessionId);
	const environment = replay.describeSessionReplayEnvironment({
		manifest: bundle.manifest,
		session,
	});
	const outDir = resolve(input.outDir ?? defaultRerunOutDir(bundleDir));
	await assertEmptyOutDir(outDir, input.outDirEntries);

	let workspace: SessionReplayRebuiltWorkspace;
	try {
		workspace = await replay.rebuildSessionReplayWorkspace({
			environment,
			parentDir: join(outDir, "workspace"),
			...(input.workspace ? { workspace: input.workspace } : {}),
			...(input.inPlace ? { inPlace: true } : {}),
			...(input.standalone ? { standalone: true } : {}),
		});
	} catch (error) {
		if (error instanceof replay.SessionReplayEnvironmentError) {
			throw new SessionRerunError(error.message);
		}
		throw error;
	}
	input.onNote?.(`workspace: ${describeRebuiltWorkspace(workspace)}`);
	for (const warning of workspace.warnings) {
		input.onNote?.(`warning: ${warning}`);
	}
	const pathMap = replay.createSessionReplayPathMap(
		environment.resolvedWorkspaceRoot ?? "",
		workspace.root,
	);

	const model = await resolveRerunModel({
		entry: session.entry,
		provider: input.provider,
		model: input.model,
	});
	const gaps = [...environment.gaps];
	let mode: "act" | "plan" | "yolo" =
		environment.mode === "plan" || environment.mode === "yolo"
			? environment.mode
			: "act";
	if (environment.mode === null) {
		const firstTurnMode =
			replay.collectSessionReplayRerunTurns(session).turns[0]?.mode;
		if (firstTurnMode) {
			mode = firstTurnMode;
			gaps.push(
				`the session mode was not recorded; the rerun started in ${mode}, the mode of the first prompt`,
			);
		}
	}
	const toolPolicies = rerunToolPolicies(environment);
	if (!toolPolicies.recorded) {
		gaps.push(
			"tool policies were not recorded; the CLI default (auto-approve) was used",
		);
	}

	const { createCliLoggerAdapter } = await import("../logging/adapter");
	const logger = createCliLoggerAdapter({
		runtime: "cli",
		component: "session-rerun",
	});
	const { readGlobalSettings, SessionSource } = await import("@cline/core");
	const { buildCliCompactionConfig } = await import("../utils/compaction-mode");
	const { resolveStartupCompactionMode } = await import(
		"../utils/startup-settings"
	);
	const { getCliBuildInfo } = await import("../utils/common");
	let systemPrompt = session.transcript.systemPrompt;
	if (systemPrompt === undefined) {
		const { resolveSystemPrompt } = await import("../runtime/prompt");
		systemPrompt = await resolveSystemPrompt({
			cwd: workspace.cwd,
			providerId: model.provider,
			mode,
		});
		gaps.push(
			"the system prompt was not recorded; the rerun built a new one for the rebuilt workspace",
		);
	} else {
		systemPrompt = pathMap.toLive(systemPrompt);
	}
	const buildInfo = getCliBuildInfo();
	const sessionId = createSessionId();
	const start: Omit<ClineCoreStartInput, "prompt" | "interactive"> = {
		source: SessionSource.CLI,
		config: {
			sessionId,
			providerId: model.provider,
			modelId: model.model,
			apiKey: model.apiKey,
			systemPrompt,
			mode,
			cwd: workspace.cwd,
			workspaceRoot: workspace.root,
			enableTools: true,
			enableSpawnAgent: mode !== "yolo",
			enableAgentTeams: mode !== "yolo",
			...(session.entry.team ? { teamName: session.entry.team.name } : {}),
			toolPolicies: toolPolicies.policies,
			execution: { loopDetection: CLI_DEFAULT_LOOP_DETECTION },
			checkpoint: CLI_DEFAULT_CHECKPOINT_CONFIG,
			compaction: buildCliCompactionConfig(
				resolveStartupCompactionMode({}, readGlobalSettings()),
			),
			...(model.reasoning.thinking !== undefined
				? { thinking: model.reasoning.thinking }
				: {}),
			...(model.reasoning.reasoningEffort
				? {
						reasoningEffort: model.reasoning
							.reasoningEffort as ClineCoreStartInput["config"]["reasoningEffort"],
					}
				: {}),
			logger: logger.core,
			extensionContext: {
				client: {
					name: "cline-cli",
					version: buildInfo.version,
					platform: "cli",
					platformVersion: buildInfo.version,
					isMultiRoot: false,
				},
				workspace: {
					rootPath: workspace.root,
					cwd: workspace.cwd,
					workspaceName: basename(workspace.cwd),
					ide: "Terminal Shell",
					platform: process.platform,
				},
				logger: logger.core,
			},
		},
	};

	const rerun = replay.createSessionReplayRerun({
		recorded: session,
		kinds: kinds.kinds,
		untilDivergence: input.untilDivergence === true,
		pathMap,
		...(input.interactive ? { decideApproval: askRerunApproval } : {}),
	});
	const answers = recordedQuestionAnswers(rerun.recordedIterations);
	const { askQuestionInTerminal, submitAndExitInTerminal } = await import(
		"../utils/approval"
	);
	const askQuestion = async (question: string, options: string[]) => {
		if (input.interactive) return askQuestionInTerminal(question, options);
		const answer = answers.shift();
		if (answer !== undefined) return pathMap.toLive(answer);
		gaps.push(
			`the rerun asked a question the recording has no answer for ("${question}"); it was answered with the first option`,
		);
		return options[0] ?? "";
	};

	const { createCliCore } = await import("./session");
	const core = await createCliCore({
		recordSession: true,
		capabilities: {
			toolExecutors: { askQuestion, submit: submitAndExitInTerminal },
			requestToolApproval: rerun.requestToolApproval,
		},
		cwd: workspace.cwd,
		workspaceRoot: workspace.root,
		toolPolicies: toolPolicies.policies,
		logger: logger.core,
	});
	const abort = () => {
		void core
			.abort(sessionId, new Error("Replay rerun aborted"))
			.catch(() => {});
	};
	input.signal?.addEventListener("abort", abort, { once: true });
	let result: Awaited<ReturnType<typeof rerun.run>>;
	try {
		result = await rerun.run({
			core,
			start,
			...(input.onProgress ? { onProgress: input.onProgress } : {}),
		});
	} finally {
		input.signal?.removeEventListener("abort", abort);
		await core.stop(sessionId).catch(() => {});
		await core.dispose("cli_session_rerun").catch(() => {});
	}

	const warnings = [...workspace.warnings, ...result.warnings];
	const liveBundleDir = join(outDir, "bundle");
	const { exportSessionReplay } = await import("./session");
	let validated: boolean | undefined;
	let liveEnv: { values: Record<string, string>; sha256: string } | undefined;
	try {
		const exported = await exportSessionReplay({
			sessionId: result.sessionId,
			bundleDir: liveBundleDir,
			redact: bundle.manifest.redaction.enabled,
			overwrite: false,
			hostVersion: cliVersion,
		});
		warnings.push(...exported.warnings);
		const segment = exported.manifest.sessions.find(
			(entry) => entry.sessionId === result.sessionId,
		)?.recording?.segments[0];
		if (segment) {
			liveEnv = { values: segment.env, sha256: segment.envSha256 };
		}
		const validation = await replay.validateSessionReplayBundle(liveBundleDir);
		validated = validation.ok;
		for (const error of validation.errors) {
			warnings.push(`rerun bundle: ${error}`);
		}
	} catch (error) {
		warnings.push(
			`The rerun session could not be exported: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const env = replay.compareSessionReplayEnv(environment.env, liveEnv);
	gaps.push(
		"the recorded env is compared, not applied: commands run in the hub process with its own env (use --in-container to apply it)",
	);

	const report: SessionReplayRerunReport = {
		format: replay.SESSION_REPLAY_RERUN_REPORT_FORMAT,
		version: replay.SESSION_REPLAY_RERUN_REPORT_VERSION,
		createdAt: new Date().toISOString(),
		recorded: { bundleDir, sessionId: session.entry.sessionId },
		live: {
			sessionId: result.sessionId,
			...(validated !== undefined
				? { bundleDir: liveBundleDir, validated }
				: {}),
		},
		workspace: {
			method: workspace.method,
			source: workspace.source,
			root: workspace.root,
			cwd: workspace.cwd,
			...(workspace.checkpoint
				? {
						checkpoint: {
							ref: workspace.checkpoint.ref,
							kind: workspace.checkpoint.kind,
							base: workspace.checkpoint.base,
						},
					}
				: {}),
		},
		env: { applied: false, changed: env.changed, unknown: env.unknown },
		options: {
			kinds: kinds.kinds,
			requestMatching: kinds.requestMatching,
			untilDivergence: input.untilDivergence === true,
			interactive: input.interactive === true,
			provider: model.provider,
			model: model.model,
			recordedProvider: session.entry.provider,
			recordedModel: session.entry.model,
		},
		turns: result.turns,
		stopped: result.stopped,
		...(result.finishReason ? { finishReason: result.finishReason } : {}),
		comparison: result.comparison,
		matches: result.matches,
		approvals: result.approvals,
		gaps,
		warnings,
	};
	const reportPath = await replay.writeSessionReplayRerunReport(outDir, report);
	return { report, reportPath, outDir };
}

/** A progress line for the text output and the TUI. */
export function formatRerunProgress(
	progress: SessionReplayRerunProgress,
): string | undefined {
	switch (progress.type) {
		case "turn":
			return `turn ${progress.turn}/${progress.of} (recorded iteration ${progress.iteration})`;
		case "iteration": {
			const kinds = [
				...new Set(progress.divergences.map((divergence) => divergence.kind)),
			];
			return `iteration ${progress.iteration}  ${kinds.length === 0 ? "same" : kinds.join(", ")}${progress.counted ? "" : kinds.length > 0 ? " (not counted)" : ""}`;
		}
		case "approval": {
			const { approval } = progress;
			return `approval ${approval.toolName}: ${approval.approved ? "approved" : "denied"} (${approval.source === "recording" ? `recorded #${approval.recordedSeq}` : approval.source})`;
		}
		case "stopped":
			return `stopped at iteration ${progress.iteration}: ${progress.divergence.kind} (--until-divergence)`;
		default:
			return undefined;
	}
}

/** The text report of `cline session replay --mode rerun`. */
export function formatSessionRerunText(input: {
	report: SessionReplayRerunReport;
	reportPath: string;
}): string[] {
	const { report } = input;
	const { comparison, options } = report;
	const fromRecording = report.approvals.filter(
		(approval) => approval.source === "recording",
	).length;
	const model =
		options.provider === options.recordedProvider &&
		options.model === options.recordedModel
			? `${options.model} (${options.provider})`
			: `${options.model} (${options.provider}), recorded with ${options.recordedModel} (${options.recordedProvider})`;
	const lines = [
		"Session rerun",
		`  recorded:  ${report.recorded.bundleDir} · session ${report.recorded.sessionId} · ${plural(comparison.iterations.recorded, "iteration")}`,
		`  rerun:     session ${report.live.sessionId} · ${plural(comparison.iterations.live, "iteration")}${report.live.bundleDir ? ` · ${report.live.bundleDir}${report.live.validated ? " (valid bundle)" : " (bundle did not validate)"}` : ""}`,
		`  workspace: ${describeRebuiltWorkspace(report.workspace)}`,
		...(report.container
			? [`  container: ${report.container.image} (${report.container.runtime})`]
			: []),
		`  model:     ${model}`,
		`  counting:  ${describeCountedKinds(comparison)} · request matching ${options.requestMatching}`,
		`  turns:     ${report.turns.sent}/${report.turns.recorded} sent${report.finishReason ? ` · finished ${report.finishReason}` : ""}`,
	];
	if (report.approvals.length > 0) {
		lines.push(
			`  approvals: ${report.approvals.length} (${fromRecording} from the recording)`,
		);
	}
	if (report.env.changed.length > 0 || report.env.unknown.length > 0) {
		lines.push(
			`  env:       ${report.env.applied ? "recorded env applied" : "recorded env not applied"}${report.env.changed.length > 0 ? ` · differs: ${report.env.changed.map((entry) => entry.key).join(", ")}` : ""}${report.env.unknown.length > 0 ? ` · redacted: ${report.env.unknown.join(", ")}` : ""}`,
		);
	}
	if (report.stopped) {
		lines.push(
			`  stopped:   at iteration ${report.stopped.iteration} (${report.stopped.kind}), --until-divergence`,
		);
	}
	lines.push("", ...formatSessionDivergenceBody(comparison));
	if (report.gaps.length > 0) {
		lines.push("", "Not reproduced", ...report.gaps.map((gap) => `  - ${gap}`));
	}
	lines.push("", `Report: ${input.reportPath}`);
	if (report.live.bundleDir) {
		lines.push(
			`Compare: cline session diff ${report.recorded.bundleDir} ${report.live.bundleDir}`,
		);
	}
	return lines;
}
