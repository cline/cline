import {
	type AgentAbortHookPayload,
	type AgentAfterToolContext,
	type AgentBeforeToolContext,
	type AgentEndHookPayload,
	type AgentErrorHookPayload,
	type AgentHooks,
	type AgentResumeHookPayload,
	type AgentRunLifecycleContext,
	type AgentRuntimeEvent,
	type AgentStartHookPayload,
	type HookControl,
	type HookEventName,
	HookEventNameSchema,
	type HookEventPayload,
	type HookEventPayloadBase,
	HookEventPayloadSchema,
	type HookSessionContextProvider,
	type PostToolUseData,
	type PreCompactData,
	type PreCompactHookPayload,
	type PreToolUseData,
	type PromptSubmitHookPayload,
	parseHookEventPayload,
	resolveHookSessionContext,
	type SessionShutdownHookPayload,
	type TaskCancelData,
	type TaskCompleteData,
	type TaskResumeData,
	type TaskStartData,
	type ToolCallHookPayload,
	type ToolResultHookPayload,
	type UserPromptSubmitData,
	type WorkspaceInfo,
} from "@cline/shared";
import { z } from "zod";
import {
	type RunSubprocessEventResult,
	runSubprocessEvent,
} from "./subprocess-runner";

type AgentHookControl = Omit<HookControl, "appendMessages"> & {
	appendMessages?: unknown[];
};

export interface HookOutput {
	contextModification: string;
	cancel: boolean;
	review?: boolean;
	errorMessage: string;
}

export const HookOutputSchema = z
	.object({
		contextModification: z.string().optional(),
		cancel: z.boolean().optional(),
		review: z.boolean().optional(),
		errorMessage: z.string().optional(),
		context: z.string().optional(),
		overrideInput: z.unknown().optional(),
	})
	.passthrough();

export { HookEventNameSchema, HookEventPayloadSchema, parseHookEventPayload };
export type {
	AgentAbortHookPayload,
	AgentEndHookPayload,
	AgentErrorHookPayload,
	AgentResumeHookPayload,
	AgentStartHookPayload,
	HookEventName,
	HookEventPayload,
	HookEventPayloadBase,
	PostToolUseData,
	PreCompactData,
	PreCompactHookPayload,
	PreToolUseData,
	PromptSubmitHookPayload,
	SessionShutdownHookPayload,
	TaskCancelData,
	TaskCompleteData,
	TaskResumeData,
	TaskStartData,
	ToolCallHookPayload,
	ToolResultHookPayload,
	UserPromptSubmitData,
};

export interface RunHookOptions {
	command?: string[];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	detached?: boolean;
	timeoutMs?: number;
	onSpawn?: (event: {
		command: string[];
		pid?: number;
		detached: boolean;
	}) => void;
}

export type RunHookResult = RunSubprocessEventResult;

const DEFAULT_HOOK_COMMAND = ["agent", "hook"];

export async function runHook(
	payload: HookEventPayload,
	options: RunHookOptions = {},
): Promise<RunHookResult | undefined> {
	const command = options.command ?? DEFAULT_HOOK_COMMAND;
	return await runSubprocessEvent(payload, {
		command,
		cwd: options.cwd,
		env: options.env,
		detached: options.detached,
		timeoutMs: options.timeoutMs,
		onSpawn: options.onSpawn,
	});
}

export interface SubprocessHooksOptions {
	command?: string[];
	cwd?: string;
	/**
	 * Structured workspace and git metadata forwarded into every hook payload
	 * as `workspaceInfo`. Obtained from `generateWorkspaceInfo` at session
	 * startup and passed here so hook scripts can inspect branch, commit, and
	 * remote without running their own `git` commands.
	 */
	workspaceInfo?: WorkspaceInfo;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
	onDispatchError?: (error: Error, payload: HookEventPayload) => void;
	onDispatch?: (event: {
		payload: HookEventPayload;
		result?: RunHookResult;
		detached: boolean;
	}) => void;
	onSpawn?: (event: {
		command: string[];
		pid?: number;
		detached: boolean;
	}) => void;
	sessionContext?: HookSessionContextProvider;
}

export interface SubprocessHookControl {
	hooks: AgentHooks;
	shutdown: (ctx: {
		agentId: string;
		conversationId: string;
		parentAgentId: string | null;
		reason?: string;
	}) => Promise<void>;
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function toHookControl(value: unknown): AgentHookControl | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const parsed = HookOutputSchema.safeParse(value);
	if (!parsed.success) {
		return undefined;
	}
	const maybe = parsed.data;
	const hasControlKey =
		"cancel" in maybe ||
		"review" in maybe ||
		"context" in maybe ||
		"contextModification" in maybe ||
		"overrideInput" in maybe ||
		"errorMessage" in maybe;
	if (!hasControlKey) {
		return undefined;
	}
	const contextFromHook =
		typeof maybe.context === "string"
			? maybe.context
			: typeof maybe.contextModification === "string"
				? maybe.contextModification
				: typeof maybe.errorMessage === "string" &&
						maybe.errorMessage.length > 0
					? maybe.errorMessage
					: undefined;
	return {
		cancel: typeof maybe.cancel === "boolean" ? maybe.cancel : undefined,
		review: typeof maybe.review === "boolean" ? maybe.review : undefined,
		context: contextFromHook,
		overrideInput: Object.hasOwn(maybe, "overrideInput")
			? maybe.overrideInput
			: undefined,
	};
}

function mapParams(input: unknown): Record<string, string> {
	if (!input || typeof input !== "object") {
		return {};
	}
	const output: Record<string, string> = {};
	for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
		if (typeof value === "string") {
			output[key] = value;
		} else {
			output[key] = JSON.stringify(value);
		}
	}
	return output;
}

function basePayload(
	hookName: HookEventName,
	ctx: {
		agentId: string;
		conversationId: string;
		parentAgentId: string | null;
	},
	options: SubprocessHooksOptions,
): HookEventPayloadBase {
	const env = options.env ?? process.env;
	const userId = env.CLINE_USER_ID?.trim() || env.USER?.trim() || "unknown";
	const workspaceRoot = options.cwd || process.cwd();
	return {
		clineVersion: env.CLINE_VERSION?.trim() || "",
		hookName,
		timestamp: new Date().toISOString(),
		taskId: ctx.conversationId,
		sessionContext: resolveHookSessionContext(options.sessionContext, {
			hookName,
			conversationId: ctx.conversationId,
			agentId: ctx.agentId,
			parentAgentId: ctx.parentAgentId,
		}),
		workspaceRoots: workspaceRoot ? [workspaceRoot] : [],
		workspaceInfo: options.workspaceInfo,
		userId,
		agent_id: ctx.agentId,
		parent_agent_id: ctx.parentAgentId,
	};
}

function serializeHookError(error: Error): AgentErrorHookPayload["error"] {
	return {
		name: error.name,
		message: error.message,
		stack: error.stack,
	};
}

function isAbortReason(reason?: string): boolean {
	const value = String(reason ?? "").toLowerCase();
	return (
		value.includes("cancel") ||
		value.includes("abort") ||
		value.includes("interrupt")
	);
}

function runtimeBase(ctx: AgentRunLifecycleContext): {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
} {
	return {
		agentId: ctx.snapshot.agentId,
		conversationId:
			ctx.snapshot.conversationId ?? ctx.snapshot.runId ?? ctx.snapshot.agentId,
		parentAgentId: ctx.snapshot.parentAgentId ?? null,
	};
}

function textFromRuntimeMessage(
	content: readonly { type: string; text?: string }[],
): string {
	return content
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("");
}

function runtimeToolRecord(
	ctx: AgentAfterToolContext,
): ToolResultHookPayload["tool_result"] {
	return {
		id: ctx.toolCall.toolCallId,
		name: ctx.toolCall.toolName,
		input: ctx.input,
		output: ctx.result.output,
		error: ctx.result.isError ? String(ctx.result.output) : undefined,
		durationMs: ctx.durationMs,
		startedAt: ctx.startedAt,
		endedAt: ctx.endedAt,
	};
}

function beforeToolResultFromControl(
	control: AgentHookControl | undefined,
): { stop?: boolean; input?: unknown } | undefined {
	if (!control) return undefined;
	const result: { stop?: boolean; input?: unknown } = {};
	if (control.cancel === true) result.stop = true;
	if (control.overrideInput !== undefined) result.input = control.overrideInput;
	return Object.keys(result).length > 0 ? result : undefined;
}

async function dispatchDetached(
	payload: HookEventPayload,
	options: SubprocessHooksOptions,
): Promise<void> {
	try {
		const result = await runHook(payload, {
			command: options.command,
			cwd: options.cwd,
			env: options.env,
			detached: true,
			onSpawn: options.onSpawn,
		});
		options.onDispatch?.({ payload, result, detached: true });
	} catch (error) {
		options.onDispatchError?.(toError(error), payload);
	}
}

export function createSubprocessHooks(
	options: SubprocessHooksOptions = {},
): SubprocessHookControl {
	const beforeRun = async (
		ctx: AgentRunLifecycleContext,
	): Promise<undefined> => {
		const base = runtimeBase(ctx);
		const isResume =
			(options.env ?? process.env).CLINE_HOOK_AGENT_RESUME === "1";
		if (isResume) {
			const resumePayload: AgentResumeHookPayload = {
				...basePayload("agent_resume", base, options),
				hookName: "agent_resume",
				taskResume: {
					taskMetadata: {},
					previousState: {},
				},
			};
			await dispatchDetached(resumePayload, options);
		} else {
			const startPayload: AgentStartHookPayload = {
				...basePayload("agent_start", base, options),
				hookName: "agent_start",
				taskStart: { taskMetadata: {} },
			};
			await dispatchDetached(startPayload, options);
		}
		return undefined;
	};

	const onEvent = async (event: AgentRuntimeEvent): Promise<void> => {
		if (event.type !== "message-added" || event.message.role !== "user") {
			return;
		}
		const base = {
			agentId: event.snapshot.agentId,
			conversationId:
				event.snapshot.conversationId ??
				event.snapshot.runId ??
				event.snapshot.agentId,
			parentAgentId: event.snapshot.parentAgentId ?? null,
		};
		const promptPayload: PromptSubmitHookPayload = {
			...basePayload("prompt_submit", base, options),
			hookName: "prompt_submit",
			userPromptSubmit: {
				prompt: textFromRuntimeMessage(event.message.content),
				attachments: [],
			},
		};
		await dispatchDetached(promptPayload, options);
	};

	const beforeTool = async (
		ctx: AgentBeforeToolContext,
	): Promise<{ stop?: boolean; input?: unknown } | undefined> => {
		const base = {
			agentId: ctx.snapshot.agentId,
			conversationId:
				ctx.snapshot.conversationId ??
				ctx.snapshot.runId ??
				ctx.snapshot.agentId,
			parentAgentId: ctx.snapshot.parentAgentId ?? null,
		};
		const payload: ToolCallHookPayload = {
			...basePayload("tool_call", base, options),
			hookName: "tool_call",
			iteration: ctx.snapshot.iteration,
			tool_call: {
				id: ctx.toolCall.toolCallId,
				name: ctx.toolCall.toolName,
				input: ctx.input,
			},
			preToolUse: {
				toolName: ctx.toolCall.toolName,
				parameters: mapParams(ctx.input),
			},
		};

		try {
			const result = await runHook(payload, {
				command: options.command,
				cwd: options.cwd,
				env: options.env,
				detached: false,
				timeoutMs: options.timeoutMs,
				onSpawn: options.onSpawn,
			});
			options.onDispatch?.({ payload, result, detached: false });
			if (result?.timedOut) {
				throw new Error("tool_call hook command timed out");
			}
			if (result?.parseError) {
				throw new Error(
					`tool_call hook produced invalid control JSON: ${result.parseError}`,
				);
			}
			return beforeToolResultFromControl(toHookControl(result?.parsedJson));
		} catch (error) {
			options.onDispatchError?.(toError(error), payload);
			return;
		}
	};

	const afterTool = async (ctx: AgentAfterToolContext): Promise<undefined> => {
		const record = runtimeToolRecord(ctx);
		const base = {
			agentId: ctx.snapshot.agentId,
			conversationId:
				ctx.snapshot.conversationId ??
				ctx.snapshot.runId ??
				ctx.snapshot.agentId,
			parentAgentId: ctx.snapshot.parentAgentId ?? null,
		};
		const payload: ToolResultHookPayload = {
			...basePayload("tool_result", base, options),
			hookName: "tool_result",
			iteration: ctx.snapshot.iteration,
			tool_result: record,
			postToolUse: {
				toolName: record.name,
				parameters: mapParams(record.input),
				result:
					typeof record.output === "string"
						? record.output
						: JSON.stringify(record.output),
				success: !record.error,
				executionTimeMs: record.durationMs,
			},
		};
		await dispatchDetached(payload, options);
		return undefined;
	};

	const afterRun: NonNullable<AgentHooks["afterRun"]> = async ({
		snapshot,
		result,
	}) => {
		const base = {
			agentId: snapshot.agentId,
			conversationId:
				snapshot.conversationId ?? snapshot.runId ?? snapshot.agentId,
			parentAgentId: snapshot.parentAgentId ?? null,
		};
		if (result.status === "completed") {
			const payload: AgentEndHookPayload = {
				...basePayload("agent_end", base, options),
				hookName: "agent_end",
				iteration: result.iterations,
				turn: { outputText: result.outputText, status: result.status },
				taskComplete: { taskMetadata: {} },
			};
			await dispatchDetached(payload, options);
			return;
		}
		const hookName: HookEventName =
			result.status === "aborted" || isAbortReason(result.error?.message)
				? "agent_abort"
				: "agent_error";
		const payload: AgentErrorHookPayload | AgentAbortHookPayload =
			hookName === "agent_error"
				? {
						...basePayload(hookName, base, options),
						hookName,
						iteration: result.iterations,
						error: serializeHookError(
							result.error ?? new Error("Agent run failed"),
						),
						taskCancel: { taskMetadata: {} },
					}
				: {
						...basePayload(hookName, base, options),
						hookName,
						reason: result.error?.message,
						taskCancel: { taskMetadata: {} },
					};
		await dispatchDetached(payload, options);
	};

	const shutdown = async ({
		agentId,
		conversationId,
		parentAgentId,
		reason,
	}: {
		agentId: string;
		conversationId: string;
		parentAgentId: string | null;
		reason?: string;
	}): Promise<void> => {
		const payload: SessionShutdownHookPayload = {
			...basePayload(
				"session_shutdown",
				{
					agentId,
					conversationId,
					parentAgentId,
				},
				options,
			),
			hookName: "session_shutdown",
			reason,
		};
		await dispatchDetached(payload, options);
	};

	return {
		hooks: {
			beforeRun,
			beforeTool,
			afterTool,
			afterRun,
			onEvent,
		},
		shutdown,
	};
}
