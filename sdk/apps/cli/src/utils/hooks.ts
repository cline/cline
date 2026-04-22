import type { AgentHooks, HookEventPayload } from "@clinebot/core";
import { closeInlineStreamIfNeeded } from "./events";
import {
	c,
	emitJsonLine,
	getActiveCliSession,
	getCurrentOutputMode,
	write,
	writeErr,
} from "./output";

const isDev = process.env.NODE_ENV === "development";

function currentHookSessionContext(): { rootSessionId: string } | undefined {
	const session = getActiveCliSession();
	if (!session) {
		return undefined;
	}
	return {
		rootSessionId: session.manifest.session_id,
	};
}

function writeHookInvocation(
	payload: HookEventPayload,
	options: { verbose: boolean },
): void {
	if (getCurrentOutputMode() === "json") {
		emitJsonLine("stdout", {
			type: "hook_event",
			hookEventName: payload.hookName,
			agentId: payload.agent_id,
			taskId: payload.taskId,
			parentAgentId: payload.parent_agent_id,
		});
		return;
	}
	if (!options.verbose) {
		if (
			payload.hookName === "tool_result" ||
			payload.hookName === "tool_call"
		) {
			return;
		}
	}
	closeInlineStreamIfNeeded();
	const hookName = payload.hookName;
	const toolName =
		payload.hookName === "tool_call"
			? payload.tool_call.name
			: payload.hookName === "tool_result"
				? payload.tool_result.name
				: undefined;
	const details = toolName ? ` ${c.cyan}${toolName}${c.reset}` : "";
	if (details) {
		write(`\n${c.dim}[hook:${hookName}]${c.reset}${details}\n`);
		return;
	}
	write(`\n${c.dim}[hook:${hookName}]${c.reset}\n`);
}

type HookRuntimeBaseContext = {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
};

type AgentHookRunStartContext = Parameters<
	NonNullable<AgentHooks["onRunStart"]>
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
type AgentHookSessionShutdownContext = Parameters<
	NonNullable<AgentHooks["onSessionShutdown"]>
>[0];

function mapParams(input: unknown): Record<string, string> {
	if (!input || typeof input !== "object") {
		return {};
	}
	const output: Record<string, string> = {};
	for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
		output[key] = typeof value === "string" ? value : JSON.stringify(value);
	}
	return output;
}

function isAbortReason(reason?: string): boolean {
	const value = String(reason ?? "").toLowerCase();
	return (
		value.includes("cancel") ||
		value.includes("abort") ||
		value.includes("interrupt")
	);
}

function serializeHookError(error: Error): {
	name: string;
	message: string;
	stack?: string;
} {
	return {
		name: error.name,
		message: error.message,
		stack: error.stack,
	};
}

function basePayload(
	ctx: HookRuntimeBaseContext,
	options: { cwd: string; workspaceRoot: string },
): Omit<HookEventPayload, "hookName"> {
	const userId =
		process.env.CLINE_USER_ID?.trim() || process.env.USER?.trim() || "unknown";
	const sessionContext = currentHookSessionContext();
	return {
		clineVersion: process.env.CLINE_VERSION?.trim() || "",
		timestamp: new Date().toISOString(),
		taskId: ctx.conversationId,
		...(sessionContext ? { sessionContext } : {}),
		workspaceRoots: [options.workspaceRoot || options.cwd].filter(Boolean),
		userId,
		agent_id: ctx.agentId,
		parent_agent_id: ctx.parentAgentId,
	};
}

async function dispatchHookPayload(
	payload: HookEventPayload,
	options: {
		dispatchHookEvent: (payload: HookEventPayload) => Promise<void>;
		verbose: boolean;
	},
): Promise<void> {
	try {
		await options.dispatchHookEvent(payload);
		writeHookInvocation(payload, { verbose: options.verbose });
	} catch (error) {
		if (isDev) {
			writeErr(
				`hook dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}

export function createRuntimeHooks(options: {
	verbose?: boolean;
	yolo?: boolean;
	cwd?: string;
	workspaceRoot?: string;
	dispatchHookEvent: (payload: HookEventPayload) => Promise<void>;
}): {
	hooks?: AgentHooks;
	shutdown: () => Promise<void>;
} {
	if (options.yolo === true) {
		return {
			hooks: undefined,
			shutdown: async () => {},
		};
	}
	const verbose = options.verbose === true;
	const cwd = options.cwd?.trim() || process.cwd();
	const workspaceRoot = options.workspaceRoot?.trim() || cwd;
	return {
		hooks: {
			onRunStart: async (ctx: AgentHookRunStartContext) => {
				const root = basePayload(ctx, { cwd, workspaceRoot });
				const isResume = process.env.CLINE_HOOK_AGENT_RESUME === "1";
				await dispatchHookPayload(
					isResume
						? {
								...root,
								hookName: "agent_resume",
								taskResume: {
									taskMetadata: {},
									previousState: {},
								},
							}
						: {
								...root,
								hookName: "agent_start",
								taskStart: { taskMetadata: {} },
							},
					{
						dispatchHookEvent: options.dispatchHookEvent,
						verbose,
					},
				);
				await dispatchHookPayload(
					{
						...basePayload(ctx, { cwd, workspaceRoot }),
						hookName: "prompt_submit",
						userPromptSubmit: {
							prompt: ctx.userMessage,
							attachments: [],
						},
					},
					{
						dispatchHookEvent: options.dispatchHookEvent,
						verbose,
					},
				);
				return undefined;
			},
			onToolCallStart: async (ctx: AgentHookToolCallStartContext) => {
				await dispatchHookPayload(
					{
						...basePayload(ctx, { cwd, workspaceRoot }),
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
					},
					{
						dispatchHookEvent: options.dispatchHookEvent,
						verbose,
					},
				);
				return undefined;
			},
			onToolCallEnd: async (ctx: AgentHookToolCallEndContext) => {
				await dispatchHookPayload(
					{
						...basePayload(ctx, { cwd, workspaceRoot }),
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
					},
					{
						dispatchHookEvent: options.dispatchHookEvent,
						verbose,
					},
				);
				return undefined;
			},
			onTurnEnd: async (ctx: AgentHookTurnEndContext) => {
				await dispatchHookPayload(
					{
						...basePayload(ctx, { cwd, workspaceRoot }),
						hookName: "agent_end",
						iteration: ctx.iteration,
						turn: ctx.turn,
						taskComplete: { taskMetadata: {} },
					},
					{
						dispatchHookEvent: options.dispatchHookEvent,
						verbose,
					},
				);
				return undefined;
			},
			onStopError: async (ctx: AgentHookStopErrorContext) => {
				const hookName = isAbortReason(ctx.error.message)
					? "agent_abort"
					: "agent_error";
				await dispatchHookPayload(
					hookName === "agent_abort"
						? {
								...basePayload(ctx, { cwd, workspaceRoot }),
								hookName,
								reason: ctx.error.message,
								taskCancel: { taskMetadata: {} },
							}
						: {
								...basePayload(ctx, { cwd, workspaceRoot }),
								hookName,
								iteration: ctx.iteration,
								error: serializeHookError(ctx.error),
								taskCancel: { taskMetadata: {} },
							},
					{
						dispatchHookEvent: options.dispatchHookEvent,
						verbose,
					},
				);
				return undefined;
			},
			onSessionShutdown: async (ctx: AgentHookSessionShutdownContext) => {
				await dispatchHookPayload(
					{
						...basePayload(ctx, { cwd, workspaceRoot }),
						hookName: "session_shutdown",
						reason: ctx.reason,
					},
					{
						dispatchHookEvent: options.dispatchHookEvent,
						verbose,
					},
				);
				return undefined;
			},
		},
		shutdown: async () => {},
	};
}
