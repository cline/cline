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
		return;
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

function baseContextFromSnapshot(snapshot: {
	agentId: string;
	conversationId?: string;
	runId?: string;
	parentAgentId?: string | null;
}): HookRuntimeBaseContext {
	return {
		agentId: snapshot.agentId,
		conversationId:
			snapshot.conversationId ?? snapshot.runId ?? snapshot.agentId,
		parentAgentId: snapshot.parentAgentId ?? null,
	};
}

function textFromMessageContent(
	content: readonly { type: string; text?: string }[],
): string {
	return content
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("");
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
			beforeRun: async (ctx) => {
				const root = basePayload(baseContextFromSnapshot(ctx.snapshot), {
					cwd,
					workspaceRoot,
				});
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
				return undefined;
			},
			beforeTool: async (ctx) => {
				await dispatchHookPayload(
					{
						...basePayload(baseContextFromSnapshot(ctx.snapshot), {
							cwd,
							workspaceRoot,
						}),
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
					},
					{
						dispatchHookEvent: options.dispatchHookEvent,
						verbose,
					},
				);
				return undefined;
			},
			afterTool: async (ctx) => {
				const record = {
					id: ctx.toolCall.toolCallId,
					name: ctx.toolCall.toolName,
					input: ctx.input,
					output: ctx.result.output,
					error: ctx.result.isError ? String(ctx.result.output) : undefined,
					durationMs: ctx.durationMs,
					startedAt: ctx.startedAt,
					endedAt: ctx.endedAt,
				};
				await dispatchHookPayload(
					{
						...basePayload(baseContextFromSnapshot(ctx.snapshot), {
							cwd,
							workspaceRoot,
						}),
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
					},
					{
						dispatchHookEvent: options.dispatchHookEvent,
						verbose,
					},
				);
				return undefined;
			},
			afterRun: async ({ snapshot, result }) => {
				const base = baseContextFromSnapshot(snapshot);
				if (result.status === "completed") {
					await dispatchHookPayload(
						{
							...basePayload(base, { cwd, workspaceRoot }),
							hookName: "agent_end",
							iteration: result.iterations,
							turn: { outputText: result.outputText, status: result.status },
							taskComplete: { taskMetadata: {} },
						},
						{
							dispatchHookEvent: options.dispatchHookEvent,
							verbose,
						},
					);
					return;
				}
				const hookName = isAbortReason(result.error?.message)
					? "agent_abort"
					: "agent_error";
				await dispatchHookPayload(
					hookName === "agent_abort"
						? {
								...basePayload(base, { cwd, workspaceRoot }),
								hookName,
								reason: result.error?.message,
								taskCancel: { taskMetadata: {} },
							}
						: {
								...basePayload(base, { cwd, workspaceRoot }),
								hookName,
								iteration: result.iterations,
								error: serializeHookError(
									result.error ?? new Error("Agent run failed"),
								),
								taskCancel: { taskMetadata: {} },
							},
					{
						dispatchHookEvent: options.dispatchHookEvent,
						verbose,
					},
				);
			},
			onEvent: async (event) => {
				if (event.type !== "message-added" || event.message.role !== "user") {
					return;
				}
				await dispatchHookPayload(
					{
						...basePayload(baseContextFromSnapshot(event.snapshot), {
							cwd,
							workspaceRoot,
						}),
						hookName: "prompt_submit",
						userPromptSubmit: {
							prompt: textFromMessageContent(event.message.content),
							attachments: [],
						},
					},
					{
						dispatchHookEvent: options.dispatchHookEvent,
						verbose,
					},
				);
			},
		},
		shutdown: async () => {},
	};
}
