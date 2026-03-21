import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { HookSessionContextProvider } from "@clinebot/shared";
import { resolveHookSessionContext } from "@clinebot/shared";
import type {
	AgentHookControl,
	AgentHookRunStartContext,
	AgentHookSessionShutdownContext,
	AgentHookStopErrorContext,
	AgentHooks,
	AgentHookToolCallEndContext,
	AgentHookToolCallStartContext,
	AgentHookTurnEndContext,
} from "../types.js";
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
} from "./subprocess.js";

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
		output[key] = typeof value === "string" ? value : JSON.stringify(value);
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
		sessionContext: resolveHookSessionContext(options.sessionContext),
		workspaceRoots: workspaceRoot ? [workspaceRoot] : [],
		userId,
		agent_id: ctx.agentId,
		parent_agent_id: ctx.parentAgentId,
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

export function createPersistentSubprocessHooks(
	options: PersistentSubprocessHooksOptions = {},
): PersistentSubprocessHookControl {
	const client = new PersistentHookClient({
		command: options.command ?? DEFAULT_HOOK_WORKER_COMMAND,
		cwd: options.cwd,
		env: options.env,
		onSpawn: options.onSpawn,
	});
	const fallback =
		options.fallbackToSubprocess === false
			? undefined
			: createSubprocessHooks({
					command: options.command?.map((segment, index) =>
						index === (options.command?.length ?? 0) - 1 &&
						segment === "hook-worker"
							? "hook"
							: segment,
					) ?? ["agent", "hook"],
					cwd: options.cwd,
					env: options.env,
					timeoutMs: options.timeoutMs,
					onSpawn: options.onSpawn,
					onDispatchError: options.onDispatchError,
					onDispatch: options.onDispatch,
					sessionContext: options.sessionContext,
				});

	const sendWithFallback = async (
		payload: HookEventPayload,
		config: {
			detached: boolean;
			timeoutMs?: number;
			fallback?: () => Promise<AgentHookControl | undefined>;
		},
	): Promise<AgentHookControl | undefined> => {
		try {
			const result = await client.send(payload, {
				timeoutMs: config.timeoutMs,
			});
			options.onDispatch?.({ payload, result, detached: config.detached });
			return toHookControl(result?.parsedJson);
		} catch (error) {
			const err = toError(error);
			options.onDispatchError?.(err, payload);
			if (config.fallback) {
				return await config.fallback();
			}
			return undefined;
		}
	};

	const onRunStart = async (
		ctx: AgentHookRunStartContext,
	): Promise<AgentHookControl | undefined> => {
		const isResume =
			(options.env ?? process.env).CLINE_HOOK_AGENT_RESUME === "1";
		const lifecyclePayload: AgentStartHookPayload | AgentResumeHookPayload =
			isResume
				? {
						...basePayload("agent_resume", ctx, options),
						hookName: "agent_resume",
						taskResume: { taskMetadata: {}, previousState: {} },
					}
				: {
						...basePayload("agent_start", ctx, options),
						hookName: "agent_start",
						taskStart: { taskMetadata: {} },
					};
		void sendWithFallback(lifecyclePayload, {
			detached: true,
			fallback: async () =>
				fallback?.hooks.onRunStart
					? ((await fallback.hooks.onRunStart(ctx)) as
							| AgentHookControl
							| undefined)
					: undefined,
		});

		const promptPayload: PromptSubmitHookPayload = {
			...basePayload("prompt_submit", ctx, options),
			hookName: "prompt_submit",
			userPromptSubmit: { prompt: ctx.userMessage, attachments: [] },
		};
		void sendWithFallback(promptPayload, { detached: true });
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
		return await sendWithFallback(payload, {
			detached: false,
			timeoutMs: options.timeoutMs,
			fallback: async () =>
				fallback?.hooks.onToolCallStart
					? ((await fallback.hooks.onToolCallStart(ctx)) as
							| AgentHookControl
							| undefined)
					: undefined,
		});
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
		void sendWithFallback(payload, {
			detached: true,
			fallback: async () =>
				fallback?.hooks.onToolCallEnd
					? ((await fallback.hooks.onToolCallEnd(ctx)) as
							| AgentHookControl
							| undefined)
					: undefined,
		});
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
		void sendWithFallback(payload, {
			detached: true,
			fallback: async () =>
				fallback?.hooks.onTurnEnd
					? ((await fallback.hooks.onTurnEnd(ctx)) as
							| AgentHookControl
							| undefined)
					: undefined,
		});
		return undefined;
	};

	const onStopError = async (
		ctx: AgentHookStopErrorContext,
	): Promise<AgentHookControl | undefined> => {
		const payload: AgentErrorHookPayload = {
			...basePayload("agent_error", ctx, options),
			hookName: "agent_error",
			iteration: ctx.iteration,
			error: {
				name: ctx.error.name,
				message: ctx.error.message,
				stack: ctx.error.stack,
			},
		};
		void sendWithFallback(payload, {
			detached: true,
			fallback: async () =>
				fallback?.hooks.onStopError
					? ((await fallback.hooks.onStopError(ctx)) as
							| AgentHookControl
							| undefined)
					: undefined,
		});
		return undefined;
	};

	const shutdown = async (ctx: {
		agentId: string;
		conversationId: string;
		parentAgentId: string | null;
		reason?: string;
	}): Promise<void> => {
		if (isAbortReason(ctx.reason)) {
			const abortPayload: AgentAbortHookPayload = {
				...basePayload("agent_abort", ctx, options),
				hookName: "agent_abort",
				reason: ctx.reason,
				taskCancel: { taskMetadata: {} },
			};
			void sendWithFallback(abortPayload, { detached: true });
		}
		const payload: SessionShutdownHookPayload = {
			...basePayload("session_shutdown", ctx, options),
			hookName: "session_shutdown",
			reason: ctx.reason,
		};
		try {
			await sendWithFallback(payload, {
				detached: true,
				fallback: async () => {
					if (fallback?.shutdown) {
						await fallback.shutdown(ctx);
					}
					return undefined;
				},
			});
		} finally {
			await client.close();
		}
	};

	return {
		client,
		hooks: {
			onRunStart,
			onToolCallStart,
			onToolCallEnd,
			onTurnEnd,
			onStopError,
			onSessionShutdown: async ({
				agentId,
				conversationId,
				parentAgentId,
				reason,
			}: AgentHookSessionShutdownContext) => {
				await shutdown({ agentId, conversationId, parentAgentId, reason });
				return undefined;
			},
		},
		shutdown,
	};
}
