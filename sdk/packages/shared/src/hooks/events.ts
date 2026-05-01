import { z } from "zod";
import type { AgentHooks } from "../agents/types";
import type { ToolCallRecord } from "../llms/tools";
import type { HookSessionContext } from "../session/hook-context";
import type { WorkspaceInfo } from "../session/workspace";

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
	/**
	 * Structured workspace and git metadata for the session.
	 *
	 * Contains `rootPath`, `hint`, `associatedRemoteUrls`,
	 * `latestGitCommitHash`, and `latestGitBranchName` — the same data as
	 * `workspaceRoots[0]` plus the git fields. Hook scripts can use this for
	 * branch-aware logic or commit attribution without running `git` themselves.
	 *
	 * `undefined` when the session has no workspace metadata (e.g. unit tests
	 * or sessions started without a `cwd`).
	 */
	workspaceInfo?: WorkspaceInfo;
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

export const HookEventPayloadSchema: z.ZodType<unknown> = z
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
		workspaceInfo: z.custom<WorkspaceInfo>().optional(),
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

export type SubprocessHookControl = AgentHookControl;
export type AgentHookRunStartPayload = AgentHookRunStartContext;
export type AgentHookToolCallStartPayload = AgentHookToolCallStartContext;
export type AgentHookToolCallEndPayload = AgentHookToolCallEndContext;
export type AgentHookTurnEndPayload = AgentHookTurnEndContext;
export type AgentHookStopErrorPayload = AgentHookStopErrorContext;
export type AgentHookSessionShutdownPayload = AgentHookSessionShutdownContext;
