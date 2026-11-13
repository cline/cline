import { resolve } from "node:path";
import {
	type AgendaTaskRuntime,
	type AgendaTaskRuntimeResult,
	ClineCore,
	FACTORY_GUIDANCE_TOOL_NAME,
	FACTORY_LIST_TOOL_NAME,
	FACTORY_STAGES_TOOL_NAME,
	FACTORY_STATUS_TOOL_NAME,
	FACTORY_TOOL_NAME,
	type FactoryGuidanceStore,
	formatAgendaTaskRunPrompt,
	SessionSource,
} from "@cline/core";
import type {
	AgendaTaskRecord,
	AgentBeforeModelContext,
	AgentMode,
	AgentResult,
} from "@cline/shared";
import type { CapturedRequest, Usage } from "./grade";

/**
 * One model session started by a trial: its role and what the model did.
 * Model requests are counted by a beforeModel hook, so they include requests
 * that ended in a tool call.
 */
export interface SessionLog {
	sessionId: string;
	role: "designer" | "judge" | "manager";
	modelRequests: number;
	finishReason?: string;
	text?: string;
	toolCalls: { name: string; input: unknown; error?: string }[];
}

export interface ModelChoice {
	providerId: string;
	modelId: string;
}

type StartInput = Parameters<ClineCore["start"]>[0];

/**
 * A fresh in-process ClineCore per trial. In a dry run every model request is
 * captured (system prompt, user message, tool names) and stopped before it
 * reaches the provider.
 */
export class EvalCore {
	readonly sessions = new Map<string, SessionLog>();
	captured?: CapturedRequest;

	private constructor(
		private readonly core: ClineCore,
		readonly model: ModelChoice,
		private readonly dryRun: boolean,
	) {}

	/** `onQuestion` receives every ask_question call; the trial decides what happens next. */
	static async create(options: {
		model: ModelChoice;
		dryRun: boolean;
		onQuestion: (question: string, options: string[]) => void;
	}): Promise<EvalCore> {
		const core = await ClineCore.create({
			clientName: "factory-decisions-eval",
			backendMode: "local",
			capabilities: {
				toolExecutors: {
					askQuestion: async (question, choices) => {
						options.onQuestion(question, choices);
						return "No answer yet.";
					},
				},
			},
		});
		return new EvalCore(core, options.model, options.dryRun);
	}

	async start(
		role: SessionLog["role"],
		input: Omit<StartInput, "config"> & {
			config: Omit<StartInput["config"], "providerId" | "modelId" | "hooks">;
		},
	): Promise<string> {
		const log: SessionLog = {
			sessionId: "",
			role,
			modelRequests: 0,
			toolCalls: [],
		};
		const started = await this.core.start({
			...input,
			config: {
				...input.config,
				providerId: this.model.providerId,
				modelId: this.model.modelId,
				hooks: {
					beforeModel: ({ request }: AgentBeforeModelContext) => {
						log.modelRequests++;
						if (!this.dryRun) return undefined;
						this.captured ??= {
							role,
							systemPrompt: request.systemPrompt ?? "",
							userMessage: lastUserText(request.messages),
							tools: request.tools.map((tool) => tool.name).sort(),
						};
						return { stop: true, reason: "dry run" };
					},
				},
			},
		});
		log.sessionId = started.sessionId;
		this.sessions.set(started.sessionId, log);
		return started.sessionId;
	}

	async send(
		sessionId: string,
		prompt: string,
		options: { mode?: AgentMode; timeoutMs?: number } = {},
	): Promise<AgentResult | undefined> {
		const result = await this.core.send({ sessionId, prompt, ...options });
		const log = this.sessions.get(sessionId);
		if (log && result) {
			log.finishReason = result.finishReason;
			log.text = result.text;
			log.toolCalls.push(
				...result.toolCalls.map((call) => ({
					name: call.name,
					input: call.input,
					...(call.error ? { error: call.error } : {}),
				})),
			);
		}
		return result;
	}

	abort(sessionId: string, reason: string): Promise<void> {
		return this.core.abort(sessionId, reason);
	}

	async abortAll(reason: string): Promise<void> {
		await Promise.allSettled(
			[...this.sessions.keys()].map((id) => this.core.abort(id, reason)),
		);
	}

	/** Summed over every session of the trial; undefined when nothing reported usage. */
	async usage(): Promise<Usage | undefined> {
		let total: Usage | undefined;
		for (const sessionId of this.sessions.keys()) {
			const summary = await this.core
				.getAccumulatedUsage(sessionId)
				.catch(() => undefined);
			const usage = summary?.aggregateUsage ?? summary?.usage;
			if (!usage) continue;
			total = {
				inputTokens: (total?.inputTokens ?? 0) + usage.inputTokens,
				outputTokens: (total?.outputTokens ?? 0) + usage.outputTokens,
				cacheReadTokens: (total?.cacheReadTokens ?? 0) + usage.cacheReadTokens,
				cacheWriteTokens:
					(total?.cacheWriteTokens ?? 0) + usage.cacheWriteTokens,
				totalCost: (total?.totalCost ?? 0) + usage.totalCost,
			};
		}
		return total;
	}

	dispose(): Promise<void> {
		return this.core.dispose();
	}
}

function lastUserText(
	messages: readonly { role: string; content: readonly unknown[] }[],
): string {
	const user = [...messages].reverse().find((m) => m.role === "user");
	return (user?.content ?? [])
		.map((part) =>
			part &&
			typeof part === "object" &&
			"type" in part &&
			part.type === "text" &&
			"text" in part
				? String(part.text)
				: "",
		)
		.join("");
}

const FACTORY_TOOLS_OFF = Object.fromEntries(
	[
		FACTORY_TOOL_NAME,
		FACTORY_LIST_TOOL_NAME,
		FACTORY_STATUS_TOOL_NAME,
		FACTORY_GUIDANCE_TOOL_NAME,
		FACTORY_STAGES_TOOL_NAME,
	].map((name) => [name, { enabled: false }]),
);

/**
 * The Hub's Factory role sessions for the two roles an eval reaches: the
 * scoper ("designer") and the duplicate check's judge. Mirrors
 * HubServerTransport.startAgendaTaskSession / runAgendaTaskSession for those
 * roles with no agent profile: same tool policy, system prompt assembly, mode,
 * user message (the exported formatAgendaTaskRunPrompt) and result mapping.
 * Differences: every session uses the eval's provider and model (the judge
 * would use the first reviewer's), and sessions run in-process instead of
 * through the Hub.
 */
export function createEvalAgendaRuntime(
	core: EvalCore,
	guidance: FactoryGuidanceStore,
	onPlanReview?: () => void,
): AgendaTaskRuntime {
	const start = async (
		task: AgendaTaskRecord,
		role: "designer" | "judge",
		sessionId: string | undefined,
	) => {
		// The Hub adds a worktree mapping rule when they differ; scoping runs
		// in the project itself, so the eval never needs it.
		if (
			task.cwd &&
			task.workspaceRoot &&
			resolve(task.cwd) !== resolve(task.workspaceRoot)
		)
			throw new Error("eval: a role session outside the project checkout");
		const location = { workspaceRoot: task.workspaceRoot ?? task.cwd };
		const roleGuidance =
			role === "designer"
				? [
						guidance.routingGuidance(location).block,
						guidance.promptBlock("designer", location),
					]
						.filter((block): block is string => !!block)
						.join("\n\n") || undefined
				: undefined;
		const base = task.systemPrompt ?? "";
		const systemPrompt = roleGuidance
			? base
				? `${base}\n\n${roleGuidance}`
				: roleGuidance
			: base;
		const roleTools =
			role === "judge" ? [] : ["read_files", "search_codebase", "skills"];
		const cwd = task.cwd ?? task.workspaceRoot ?? "";
		return {
			sessionId: await core.start(role, {
				source: SessionSource.CORE,
				interactive: role === "designer",
				config: {
					...(sessionId ? { sessionId } : {}),
					cwd,
					workspaceRoot: cwd,
					configurationRoot: task.workspaceRoot ?? cwd,
					systemPrompt,
					mode: task.mode ?? "act",
					maxIterations: task.maxIterations,
					enableTools: true,
					enableSpawnAgent: false,
					enableAgentTeams: false,
				},
				toolPolicies: {
					"*": { autoApprove: role !== "designer", enabled: false },
					...Object.fromEntries(
						roleTools.map((name) => [
							name,
							{ enabled: true, autoApprove: true },
						]),
					),
					...(role === "designer"
						? { ask_question: { enabled: true, autoApprove: true } }
						: {}),
					...FACTORY_TOOLS_OFF,
				},
			}),
		};
	};
	const run = async (
		sessionId: string,
		task: AgendaTaskRecord,
	): Promise<AgendaTaskRuntimeResult> => {
		let result: AgentResult | undefined;
		try {
			result = await core.send(sessionId, formatAgendaTaskRunPrompt(task), {
				mode: task.mode ?? "act",
				...(task.timeoutSeconds
					? { timeoutMs: task.timeoutSeconds * 1000 }
					: {}),
			});
		} catch (error) {
			return {
				status: "failed",
				error: error instanceof Error ? error.message : String(error),
			};
		}
		const summary = result?.text?.trim() || undefined;
		return result?.finishReason === "completed"
			? { status: "completed", summary }
			: result?.finishReason === "aborted"
				? { status: "cancelled", summary }
				: {
						status: "failed",
						summary,
						error:
							summary ??
							(result?.finishReason
								? `Task session ended with ${result.finishReason}`
								: "Task session did not return a completion result"),
					};
	};
	return {
		startDesignSession: (task, _clientId, _agent, sessionId) =>
			start({ ...task, mode: "plan" }, "designer", sessionId),
		runDesignSession: (sessionId, task) => run(sessionId, task),
		// Plan review is not part of the eval: reaching it means the scoper
		// answered with a plan, which is where the scoper trial ends.
		startDesignReviewSession: async () => {
			onPlanReview?.();
			throw new Error("eval: plan review is not run");
		},
		startSession: async (task, _run, _clientId, options) => {
			if (options?.factoryRole !== "judge")
				throw new Error(
					`eval: only scoping and the duplicate check run (asked for ${options?.factoryRole ?? "an agenda task"})`,
				);
			return start(task, "judge", options.sessionId);
		},
		runSession: (sessionId, task) => run(sessionId, task),
		abortSession: (sessionId, reason) => core.abort(sessionId, reason ?? ""),
	};
}
