import type { AgentHooks } from "@clinebot/agents";
import type {
	HookSessionContext,
	HookSessionContextProvider,
	ToolCallRecord,
} from "@clinebot/shared";
import { resolveHookSessionContext } from "@clinebot/shared";
import { z } from "zod";
import {
	type RunSubprocessEventResult,
	runSubprocessEvent,
} from "./subprocess-runner";

type AgentHookControl = NonNullable<
	Awaited<ReturnType<NonNullable<AgentHooks["onToolCallStart"]>>>
>;
type AgentHookRunStartContext = Parameters<
	NonNullable<AgentHooks["onRunStart"]>
>[0];
type AgentHookSessionShutdownContext = Parameters<
	NonNullable<AgentHooks["onSessionShutdown"]>
>[0];
type AgentHookStopErrorContext = Parameters<
	NonNullable<AgentHooks["onStopError"]>
>[0];
type AgentHookToolCallEndContext = Parameters<
	NonNullable<AgentHooks["onToolCallEnd"]>
>[0];
type AgentHookToolCallStartContext = Parameters<
	NonNullable<AgentHooks["onToolCallStart"]>
>[0];
type AgentHookTurnEndContext = Parameters<
	NonNullable<AgentHooks["onTurnEnd"]>
>[0];

export const HookEventNameSchema = z.enum([
	"agent_start",
	"agent_resume",
	"agent_abort",
	"agent_end",
	"agent_error",
	"tool_call",
	"tool_result",
	"prompt_submit",
	"pre_compact",
	"session_shutdown",
]);

export type HookEventName = z.infer<typeof HookEventNameSchema>;

const StringMapSchema = z.record(z.string(), z.string());

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

export interface PreToolUseData {
	toolName: string;
	parameters: Record<string, string>;
}

export interface PostToolUseData {
	toolName: string;
	parameters: Record<string, string>;
	result: string;
	success: boolean;
	executionTimeMs: number;
}

export interface UserPromptSubmitData {
	prompt: string;
	attachments: string[];
}

export interface TaskStartData {
	taskMetadata: Record<string, string>;
}

export interface TaskResumeData {
	taskMetadata: Record<string, string>;
	previousState: Record<string, string>;
}

export interface TaskCancelData {
	taskMetadata: Record<string, string>;
}

export interface TaskCompleteData {
	taskMetadata: Record<string, string>;
}

export interface PreCompactData {
	taskId: string;
	ulid: string;
	contextSize: number;
	compactionStrategy: string;
	previousApiReqIndex: number;
	tokensIn: number;
	tokensOut: number;
	tokensInCache: number;
	tokensOutCache: number;
	deletedRangeStart: number;
	deletedRangeEnd: number;
	contextJsonPath: string;
	contextRawPath: string;
}

const PreToolUseDataSchema = z.object({
	toolName: z.string(),
	parameters: StringMapSchema,
});

const PostToolUseDataSchema = z.object({
	toolName: z.string(),
	parameters: StringMapSchema,
	result: z.string(),
	success: z.boolean(),
	executionTimeMs: z.number(),
});

const UserPromptSubmitDataSchema = z.object({
	prompt: z.string(),
	attachments: z.array(z.string()),
});

const TaskStartDataSchema = z.object({ taskMetadata: StringMapSchema });
const TaskResumeDataSchema = z.object({
	taskMetadata: StringMapSchema,
	previousState: StringMapSchema,
});
const TaskCancelDataSchema = z.object({ taskMetadata: StringMapSchema });
const TaskCompleteDataSchema = z.object({ taskMetadata: StringMapSchema });

const PreCompactDataSchema = z.object({
	taskId: z.string(),
	ulid: z.string(),
	contextSize: z.number(),
	compactionStrategy: z.string(),
	previousApiReqIndex: z.number(),
	tokensIn: z.number(),
	tokensOut: z.number(),
	tokensInCache: z.number(),
	tokensOutCache: z.number(),
	deletedRangeStart: z.number(),
	deletedRangeEnd: z.number(),
	contextJsonPath: z.string(),
	contextRawPath: z.string(),
});

export interface HookEventPayloadBase {
	clineVersion: string;
	hookName: HookEventName;
	timestamp: string;
	taskId: string;
	sessionContext?: HookSessionContext;
	workspaceRoots: string[];
	userId: string;
	agent_id: string;
	parent_agent_id: string | null;
	preToolUse?: PreToolUseData | undefined;
	postToolUse?: PostToolUseData | undefined;
	userPromptSubmit?: UserPromptSubmitData | undefined;
	taskStart?: TaskStartData | undefined;
	taskResume?: TaskResumeData | undefined;
	taskCancel?: TaskCancelData | undefined;
	taskComplete?: TaskCompleteData | undefined;
	preCompact?: PreCompactData | undefined;
}

export interface ToolCallHookPayload extends HookEventPayloadBase {
	hookName: "tool_call";
	iteration: number;
	tool_call: {
		id: string;
		name: string;
		input: unknown;
	};
}

export interface ToolResultHookPayload extends HookEventPayloadBase {
	hookName: "tool_result";
	iteration: number;
	tool_result: ToolCallRecord;
}

export interface AgentEndHookPayload extends HookEventPayloadBase {
	hookName: "agent_end";
	iteration: number;
	turn: AgentHookTurnEndContext["turn"];
}

export interface AgentErrorHookPayload extends HookEventPayloadBase {
	hookName: "agent_error";
	iteration: number;
	error: {
		name: string;
		message: string;
		stack?: string;
	};
}

export interface AgentStartHookPayload extends HookEventPayloadBase {
	hookName: "agent_start";
}

export interface AgentResumeHookPayload extends HookEventPayloadBase {
	hookName: "agent_resume";
}

export interface AgentAbortHookPayload extends HookEventPayloadBase {
	hookName: "agent_abort";
	reason?: string;
}

export interface PromptSubmitHookPayload extends HookEventPayloadBase {
	hookName: "prompt_submit";
}

export interface PreCompactHookPayload extends HookEventPayloadBase {
	hookName: "pre_compact";
	preCompact: PreCompactData;
}

export interface SessionShutdownHookPayload extends HookEventPayloadBase {
	hookName: "session_shutdown";
	reason?: string;
}

export type HookEventPayload =
	| ToolCallHookPayload
	| ToolResultHookPayload
	| AgentStartHookPayload
	| AgentResumeHookPayload
	| AgentAbortHookPayload
	| PromptSubmitHookPayload
	| PreCompactHookPayload
	| AgentEndHookPayload
	| AgentErrorHookPayload
	| SessionShutdownHookPayload;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const HookEventPayloadSchema: z.ZodType<any> = z
	.object({
		clineVersion: z.string(),
		hookName: HookEventNameSchema,
		timestamp: z.string(),
		taskId: z.string(),
		sessionContext: z
			.object({
				rootSessionId: z.string().optional(),
				hookLogPath: z.string().optional(),
			})
			.optional(),
		workspaceRoots: z.array(z.string()),
		userId: z.string(),
		agent_id: z.string(),
		parent_agent_id: z.string().nullable(),
		iteration: z.number().optional(),
		reason: z.string().optional(),
		tool_call: z
			.object({
				id: z.string(),
				name: z.string(),
				input: z.unknown(),
			})
			.optional(),
		tool_result: z.custom<ToolCallRecord>().optional(),
		turn: z.custom<AgentHookTurnEndContext["turn"]>().optional(),
		error: z
			.object({
				name: z.string(),
				message: z.string(),
				stack: z.string().optional(),
			})
			.optional(),
		preToolUse: PreToolUseDataSchema.optional(),
		postToolUse: PostToolUseDataSchema.optional(),
		userPromptSubmit: UserPromptSubmitDataSchema.optional(),
		taskStart: TaskStartDataSchema.optional(),
		taskResume: TaskResumeDataSchema.optional(),
		taskCancel: TaskCancelDataSchema.optional(),
		taskComplete: TaskCompleteDataSchema.optional(),
		preCompact: PreCompactDataSchema.optional(),
	})
	.passthrough();

export function parseHookEventPayload(
	value: unknown,
): HookEventPayload | undefined {
	const parsed = HookEventPayloadSchema.safeParse(value);
	if (!parsed.success) {
		return undefined;
	}
	return parsed.data as HookEventPayload;
}

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
	const onRunStart = async (
		ctx: AgentHookRunStartContext,
	): Promise<AgentHookControl | undefined> => {
		const isResume =
			(options.env ?? process.env).CLINE_HOOK_AGENT_RESUME === "1";
		if (isResume) {
			const resumePayload: AgentResumeHookPayload = {
				...basePayload("agent_resume", ctx, options),
				hookName: "agent_resume",
				taskResume: {
					taskMetadata: {},
					previousState: {},
				},
			};
			await dispatchDetached(resumePayload, options);
		} else {
			const startPayload: AgentStartHookPayload = {
				...basePayload("agent_start", ctx, options),
				hookName: "agent_start",
				taskStart: { taskMetadata: {} },
			};
			await dispatchDetached(startPayload, options);
		}

		const promptPayload: PromptSubmitHookPayload = {
			...basePayload("prompt_submit", ctx, options),
			hookName: "prompt_submit",
			userPromptSubmit: {
				prompt: ctx.userMessage,
				attachments: [],
			},
		};
		await dispatchDetached(promptPayload, options);
		return undefined;
	};

	const onToolCallStart = async (
		ctx: AgentHookToolCallStartContext,
	): Promise<AgentHookControl | undefined> => {
		const payload: ToolCallHookPayload = {
			...basePayload("tool_call", ctx, options),
			hookName: "tool_call",
			iteration: ctx.iteration,
			tool_call: {
				id: ctx.call.id,
				name: ctx.call.name,
				input: ctx.call.input,
			},
			preToolUse: {
				toolName: ctx.call.name,
				parameters: mapParams(ctx.call.input),
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
			return toHookControl(result?.parsedJson);
		} catch (error) {
			options.onDispatchError?.(toError(error), payload);
			return;
		}
	};

	const onToolCallEnd = async (
		ctx: AgentHookToolCallEndContext,
	): Promise<AgentHookControl | undefined> => {
		const payload: ToolResultHookPayload = {
			...basePayload("tool_result", ctx, options),
			hookName: "tool_result",
			iteration: ctx.iteration,
			tool_result: ctx.record,
			postToolUse: {
				toolName: ctx.record.name,
				parameters: mapParams(ctx.record.input),
				result:
					typeof ctx.record.output === "string"
						? ctx.record.output
						: JSON.stringify(ctx.record.output),
				success: !ctx.record.error,
				executionTimeMs: ctx.record.durationMs,
			},
		};
		await dispatchDetached(payload, options);
		return undefined;
	};

	const onTurnEnd = async (
		ctx: AgentHookTurnEndContext,
	): Promise<AgentHookControl | undefined> => {
		const payload: AgentEndHookPayload = {
			...basePayload("agent_end", ctx, options),
			hookName: "agent_end",
			iteration: ctx.iteration,
			turn: ctx.turn,
			taskComplete: { taskMetadata: {} },
		};
		await dispatchDetached(payload, options);
		return undefined;
	};

	const onStopError = async (
		ctx: AgentHookStopErrorContext,
	): Promise<AgentHookControl | undefined> => {
		const hookName: HookEventName = isAbortReason(ctx.error.message)
			? "agent_abort"
			: "agent_error";
		const payload: AgentErrorHookPayload | AgentAbortHookPayload =
			hookName === "agent_error"
				? {
						...basePayload(hookName, ctx, options),
						hookName,
						iteration: ctx.iteration,
						error: serializeHookError(ctx.error),
						taskCancel: { taskMetadata: {} },
					}
				: {
						...basePayload(hookName, ctx, options),
						hookName,
						reason: ctx.error.message,
						taskCancel: { taskMetadata: {} },
					};
		await dispatchDetached(payload, options);
		return undefined;
	};

	const shutdown = async ({
		agentId,
		conversationId,
		parentAgentId,
		reason,
	}: AgentHookSessionShutdownContext): Promise<void> => {
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
			onRunStart,
			onToolCallStart,
			onToolCallEnd,
			onTurnEnd,
			onStopError,
		},
		shutdown,
	};
}
