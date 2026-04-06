import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { AgentHooks } from "@clinebot/agents";
import type { HookSessionContextProvider } from "@clinebot/shared";
import { resolveHookSessionContext } from "@clinebot/shared";
import {
	type AgentAbortHookPayload,
	type AgentEndHookPayload,
	type AgentErrorHookPayload,
	type AgentResumeHookPayload,
	type AgentStartHookPayload,
	createSubprocessHooks,
	type HookEventName,
	type HookEventPayload,
	type HookEventPayloadBase,
	HookOutputSchema,
	type PromptSubmitHookPayload,
	type RunHookResult,
	type SessionShutdownHookPayload,
	type ToolCallHookPayload,
	type ToolResultHookPayload,
} from "./subprocess";

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

interface PersistentHookRequest {
	id: string;
	payload: HookEventPayload;
}

interface PersistentHookResponse {
	id: string;
	ok: boolean;
	result?: RunHookResult;
	error?: string;
}

interface PendingRequest {
	resolve: (result: RunHookResult | undefined) => void;
	reject: (error: Error) => void;
	timeoutId?: NodeJS.Timeout;
}

export interface PersistentHookClientOptions {
	command: string[];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	onSpawn?: (event: {
		command: string[];
		pid?: number;
		detached: boolean;
	}) => void;
}

export class PersistentHookClient {
	private readonly options: PersistentHookClientOptions;
	private child?: ChildProcessWithoutNullStreams;
	private startPromise?: Promise<void>;
	private readonly pending = new Map<string, PendingRequest>();
	private nextId = 0;
	private stdoutBuffer = "";
	private closing = false;

	constructor(options: PersistentHookClientOptions) {
		this.options = options;
	}

	async send(
		payload: HookEventPayload,
		options?: { timeoutMs?: number },
	): Promise<RunHookResult | undefined> {
		await this.ensureStarted();
		const child = this.child;
		if (!child?.stdin || child.stdin.destroyed) {
			throw new Error("persistent hook worker stdin is unavailable");
		}

		const id = `hook_req_${String(++this.nextId).padStart(8, "0")}`;
		const frame = `${JSON.stringify({ id, payload } satisfies PersistentHookRequest)}\n`;

		return await new Promise<RunHookResult | undefined>((resolve, reject) => {
			const pending: PendingRequest = { resolve, reject };
			const timeoutMs = options?.timeoutMs ?? 0;
			if (timeoutMs > 0) {
				pending.timeoutId = setTimeout(() => {
					this.pending.delete(id);
					reject(
						new Error(`Persistent hook request timed out after ${timeoutMs}ms`),
					);
				}, timeoutMs);
			}
			this.pending.set(id, pending);
			child.stdin.write(frame, (error) => {
				if (!error) {
					return;
				}
				this.clearPendingRequest(id);
				reject(error instanceof Error ? error : new Error(String(error)));
			});
		});
	}

	async close(): Promise<void> {
		this.closing = true;
		for (const id of [...this.pending.keys()]) {
			this.rejectPendingRequest(id, new Error("persistent hook worker closed"));
		}
		const child = this.child;
		this.child = undefined;
		this.startPromise = undefined;
		this.stdoutBuffer = "";
		if (!child) {
			return;
		}
		await new Promise<void>((resolve) => {
			let settled = false;
			let forceKillId: NodeJS.Timeout | undefined;
			const finish = () => {
				if (settled) {
					return;
				}
				settled = true;
				if (forceKillId) {
					clearTimeout(forceKillId);
				}
				resolve();
			};

			child.once("close", () => finish());

			try {
				child.stdin.end();
			} catch {
				// Ignore stdin shutdown failures and continue to terminate the child.
			}

			if (!child.killed) {
				try {
					child.kill("SIGTERM");
				} catch {
					finish();
					return;
				}
			}

			forceKillId = setTimeout(() => {
				if (!child.killed) {
					try {
						child.kill("SIGKILL");
					} catch {
						// Ignore final kill errors.
					}
				}
			}, 250);

			setTimeout(() => finish(), 1000);
		});
	}

	private async ensureStarted(): Promise<void> {
		if (this.child && !this.child.killed) {
			return;
		}
		if (this.startPromise) {
			return await this.startPromise;
		}
		this.closing = false;
		this.startPromise = this.start();
		try {
			await this.startPromise;
		} finally {
			this.startPromise = undefined;
		}
	}

	private async start(): Promise<void> {
		const command = this.options.command;
		if (!Array.isArray(command) || command.length === 0) {
			throw new Error("PersistentHookClient requires a non-empty command");
		}
		const child = spawn(command[0], command.slice(1), {
			cwd: this.options.cwd,
			env: this.options.env,
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.child = child;
		this.stdoutBuffer = "";

		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			this.handleStdout(chunk);
		});

		child.stderr.setEncoding("utf8");
		let stderr = "";
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});

		child.once("error", (error) => {
			this.handleChildExit(
				error instanceof Error ? error : new Error(String(error)),
			);
		});
		child.once("close", (code, signal) => {
			const detail =
				stderr.trim() ||
				`persistent hook worker exited with code ${code ?? "null"}${signal ? ` signal ${signal}` : ""}`;
			this.handleChildExit(new Error(detail));
		});

		await new Promise<void>((resolve, reject) => {
			child.once("spawn", () => {
				try {
					this.options.onSpawn?.({
						command,
						pid: child.pid ?? undefined,
						detached: false,
					});
				} catch {
					// Logging callbacks must not break subprocess execution.
				}
				resolve();
			});
			child.once("error", (error) =>
				reject(error instanceof Error ? error : new Error(String(error))),
			);
		});
	}

	private handleStdout(chunk: string): void {
		this.stdoutBuffer += chunk;
		let newlineIndex = this.stdoutBuffer.indexOf("\n");
		while (newlineIndex >= 0) {
			const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
			this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
			if (line) {
				this.handleResponseLine(line);
			}
			newlineIndex = this.stdoutBuffer.indexOf("\n");
		}
	}

	private handleResponseLine(line: string): void {
		let parsed: PersistentHookResponse;
		try {
			parsed = JSON.parse(line) as PersistentHookResponse;
		} catch {
			return;
		}
		if (!parsed || typeof parsed.id !== "string") {
			return;
		}
		const pending = this.clearPendingRequest(parsed.id);
		if (!pending) {
			return;
		}
		if (!parsed.ok) {
			pending.reject(
				new Error(parsed.error || "persistent hook worker failed"),
			);
			return;
		}
		pending.resolve(parsed.result);
	}

	private handleChildExit(error: Error): void {
		const child = this.child;
		if (!child) {
			return;
		}
		this.child = undefined;
		this.stdoutBuffer = "";
		if (this.closing) {
			return;
		}
		for (const id of [...this.pending.keys()]) {
			this.rejectPendingRequest(id, error);
		}
	}

	private clearPendingRequest(id: string): PendingRequest | undefined {
		const pending = this.pending.get(id);
		if (!pending) {
			return undefined;
		}
		this.pending.delete(id);
		if (pending.timeoutId) {
			clearTimeout(pending.timeoutId);
		}
		return pending;
	}

	private rejectPendingRequest(id: string, error: Error): void {
		const pending = this.clearPendingRequest(id);
		pending?.reject(error);
	}
}

export interface PersistentSubprocessHooksOptions {
	command?: string[];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
	onSpawn?: (event: {
		command: string[];
		pid?: number;
		detached: boolean;
	}) => void;
	onDispatchError?: (error: Error, payload: HookEventPayload) => void;
	onDispatch?: (event: {
		payload: HookEventPayload;
		result?: RunHookResult;
		detached: boolean;
	}) => void;
	sessionContext?: HookSessionContextProvider;
	fallbackToSubprocess?: boolean;
}

export interface PersistentSubprocessHookControl {
	hooks: AgentHooks;
	shutdown: (ctx: {
		agentId: string;
		conversationId: string;
		parentAgentId: string | null;
		reason?: string;
	}) => Promise<void>;
	client: PersistentHookClient;
}

const DEFAULT_HOOK_WORKER_COMMAND = ["agent", "hook-worker"];

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
	options: PersistentSubprocessHooksOptions,
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
	client: PersistentHookClient,
	payload: HookEventPayload,
	options: PersistentSubprocessHooksOptions,
): Promise<void> {
	try {
		const result = await client.send(payload);
		options.onDispatch?.({ payload, result, detached: true });
	} catch (error) {
		options.onDispatchError?.(toError(error), payload);
	}
}

export function createPersistentSubprocessHooks(
	options: PersistentSubprocessHooksOptions = {},
): PersistentSubprocessHookControl {
	const command = options.command ?? DEFAULT_HOOK_WORKER_COMMAND;
	const client = new PersistentHookClient({
		command,
		cwd: options.cwd,
		env: options.env,
		onSpawn: options.onSpawn,
	});

	const fallbackHooks = options.fallbackToSubprocess
		? createSubprocessHooks(options)
		: undefined;

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
			await dispatchDetached(client, resumePayload, options);
		} else {
			const startPayload: AgentStartHookPayload = {
				...basePayload("agent_start", ctx, options),
				hookName: "agent_start",
				taskStart: { taskMetadata: {} },
			};
			await dispatchDetached(client, startPayload, options);
		}

		const promptPayload: PromptSubmitHookPayload = {
			...basePayload("prompt_submit", ctx, options),
			hookName: "prompt_submit",
			userPromptSubmit: {
				prompt: ctx.userMessage,
				attachments: [],
			},
		};
		await dispatchDetached(client, promptPayload, options);
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
			const result = await client.send(payload, {
				timeoutMs: options.timeoutMs,
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
			if (fallbackHooks) {
				return await fallbackHooks.hooks.onToolCallStart?.(ctx);
			}
			return undefined;
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
		await dispatchDetached(client, payload, options);
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
		await dispatchDetached(client, payload, options);
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
		await dispatchDetached(client, payload, options);
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
		await dispatchDetached(client, payload, options);
		await client.close();
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
		client,
	};
}
