import { spawn } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import type {
	AgentHooks,
	HookEventName,
	HookEventPayload,
} from "@clinebot/agents";
import type { BasicLogger, HookSessionContext } from "@clinebot/shared";
import { ensureParentDir } from "@clinebot/shared/storage";
import { listHookConfigFiles } from "../agents/hooks-config-loader";

type HookContextBase = {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
};

type AgentHookControl = NonNullable<
	Awaited<ReturnType<NonNullable<AgentHooks["onToolCallStart"]>>>
>;
type AgentHookRunStartContext = Parameters<
	NonNullable<AgentHooks["onRunStart"]>
>[0];
type AgentHookToolCallStartContext = Parameters<
	NonNullable<AgentHooks["onToolCallStart"]>
>[0];
type AgentHookToolCallEndContext = Parameters<
	NonNullable<AgentHooks["onToolCallEnd"]>
>[0];
type AgentHookTurnEndContext = Parameters<
	NonNullable<AgentHooks["onTurnEnd"]>
>[0];
type AgentHookStopErrorContext = Parameters<
	NonNullable<AgentHooks["onStopError"]>
>[0];
type AgentHookSessionShutdownContext = Parameters<
	NonNullable<AgentHooks["onSessionShutdown"]>
>[0];

type HookRuntimeOptions = {
	cwd: string;
	workspacePath: string;
	hookLogPath?: string;
	rootSessionId?: string;
	logger?: BasicLogger;
	toolCallTimeoutMs?: number;
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

function logHookError(
	logger: BasicLogger | undefined,
	message: string,
	error?: unknown,
): void {
	const detail = error instanceof Error ? `: ${error.message}` : "";
	const text = `${message}${detail}`;
	if (logger?.warn) {
		logger.warn(text);
		return;
	}
	console.warn(text);
}

function mergeHookControls(
	current: AgentHookControl | undefined,
	next: AgentHookControl | undefined,
): AgentHookControl | undefined {
	if (!next) {
		return current;
	}
	if (!current) {
		return { ...next };
	}
	const contexts = [current.context, next.context]
		.filter(
			(value): value is string => typeof value === "string" && value.length > 0,
		)
		.join("\n");
	const appendMessages = [
		...(current.appendMessages ?? []),
		...(next.appendMessages ?? []),
	];
	return {
		cancel: current.cancel === true || next.cancel === true ? true : undefined,
		review: current.review === true || next.review === true ? true : undefined,
		context: contexts || undefined,
		overrideInput:
			next.overrideInput !== undefined
				? next.overrideInput
				: current.overrideInput,
		systemPrompt:
			next.systemPrompt !== undefined
				? next.systemPrompt
				: current.systemPrompt,
		appendMessages: appendMessages.length > 0 ? appendMessages : undefined,
	};
}

function parseHookControl(value: unknown): AgentHookControl | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const context =
		typeof record.context === "string"
			? record.context
			: typeof record.contextModification === "string"
				? record.contextModification
				: typeof record.errorMessage === "string"
					? record.errorMessage
					: undefined;
	return {
		cancel: typeof record.cancel === "boolean" ? record.cancel : undefined,
		review: typeof record.review === "boolean" ? record.review : undefined,
		context,
		overrideInput: Object.hasOwn(record, "overrideInput")
			? record.overrideInput
			: undefined,
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

function ensureHookLogDir(filePath: string): void {
	ensureParentDir(filePath);
}

function createPayloadBase(
	ctx: HookContextBase,
	options: HookRuntimeOptions,
): Omit<HookEventPayload, "hookName"> {
	const userId =
		process.env.CLINE_USER_ID?.trim() || process.env.USER?.trim() || "unknown";
	const sessionContext: HookSessionContext = {
		rootSessionId: options.rootSessionId || ctx.conversationId,
		hookLogPath: options.hookLogPath,
	};
	return {
		clineVersion: process.env.CLINE_VERSION?.trim() || "",
		timestamp: new Date().toISOString(),
		taskId: ctx.conversationId,
		sessionContext,
		workspaceRoots: options.workspacePath ? [options.workspacePath] : [],
		userId,
		agent_id: ctx.agentId,
		parent_agent_id: ctx.parentAgentId,
	} as Omit<HookEventPayload, "hookName">;
}

type HookCommandMap = Partial<Record<HookEventName, string[][]>>;

interface HookCommandResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	parsedJson?: unknown;
	parseError?: string;
	timedOut?: boolean;
}

function parseHookStdout(stdout: string): {
	parsedJson?: unknown;
	parseError?: string;
} {
	const trimmed = stdout.trim();
	if (!trimmed) {
		return {};
	}
	const lines = trimmed
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const prefixed = lines
		.filter((line) => line.startsWith("HOOK_CONTROL\t"))
		.map((line) => line.slice("HOOK_CONTROL\t".length));
	const candidate =
		prefixed.length > 0 ? prefixed[prefixed.length - 1] : trimmed;
	try {
		return { parsedJson: JSON.parse(candidate) };
	} catch (error) {
		return {
			parseError:
				error instanceof Error
					? error.message
					: "Failed to parse hook stdout JSON",
		};
	}
}

async function writeToChildStdin(
	child: ReturnType<typeof spawn>,
	body: string,
): Promise<void> {
	const stdin = child.stdin;
	if (!stdin) {
		throw new Error("hook command failed to create stdin");
	}

	await new Promise<void>((resolve, reject) => {
		let settled = false;
		const finish = (error?: Error | null) => {
			if (settled) {
				return;
			}
			settled = true;
			stdin.off("error", onError);
			stdin.off("close", onClose);
			if (error) {
				const code = (error as Error & { code?: string }).code;
				if (code === "EPIPE" || code === "ERR_STREAM_DESTROYED") {
					resolve();
					return;
				}
				reject(error);
				return;
			}
			resolve();
		};
		const onError = (error: Error) => finish(error);
		const onClose = () => finish();
		stdin.on("error", onError);
		stdin.once("close", onClose);
		stdin.end(body, (error?: Error | null) => finish(error));
	});
}

async function runHookCommand(
	payload: HookEventPayload,
	options: {
		command: string[];
		cwd: string;
		env?: NodeJS.ProcessEnv;
		detached: boolean;
		timeoutMs?: number;
	},
): Promise<HookCommandResult | undefined> {
	if (options.command.length === 0) {
		throw new Error("runHookCommand requires non-empty command");
	}
	const child = spawn(options.command[0], options.command.slice(1), {
		cwd: options.cwd,
		env: options.env,
		stdio: options.detached
			? ["pipe", "ignore", "ignore"]
			: ["pipe", "pipe", "pipe"],
		detached: options.detached,
	});
	const spawned = new Promise<void>((resolve) => {
		child.once("spawn", () => resolve());
	});
	const childError = new Promise<never>((_, reject) => {
		child.once("error", (error) => reject(error));
	});

	const body = JSON.stringify(payload);
	await writeToChildStdin(child, body);

	if (options.detached) {
		await Promise.race([spawned, childError]);
		child.unref();
		return;
	}

	if (!child.stdout || !child.stderr) {
		throw new Error("hook command failed to create stdout/stderr");
	}
	let stdout = "";
	let stderr = "";
	let timedOut = false;
	let timeoutId: NodeJS.Timeout | undefined;
	child.stdout.on("data", (chunk: Buffer | string) => {
		stdout += chunk.toString();
	});
	child.stderr.on("data", (chunk: Buffer | string) => {
		stderr += chunk.toString();
	});

	const result = new Promise<HookCommandResult>((resolve) => {
		if ((options.timeoutMs ?? 0) > 0) {
			timeoutId = setTimeout(() => {
				timedOut = true;
				child.kill("SIGKILL");
			}, options.timeoutMs);
		}
		child.once("close", (exitCode) => {
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
			const { parsedJson, parseError } = parseHookStdout(stdout);
			resolve({
				exitCode,
				stdout,
				stderr,
				parsedJson,
				parseError,
				timedOut,
			});
		});
	});
	return await Promise.race([result, childError]);
}

function parseShebangCommand(path: string): string[] | undefined {
	try {
		const content = readFileSync(path, "utf8");
		const firstLine = content.split(/\r?\n/, 1)[0]?.trim();
		if (!firstLine?.startsWith("#!")) {
			return undefined;
		}
		const shebang = firstLine.slice(2).trim();
		if (!shebang) {
			return undefined;
		}
		const tokens = shebang.split(/\s+/).filter(Boolean);
		return tokens.length > 0 ? tokens : undefined;
	} catch {
		return undefined;
	}
}

function inferHookCommand(path: string): string[] {
	const shebang = parseShebangCommand(path);
	if (shebang && shebang.length > 0) {
		return [...shebang, path];
	}
	const lowered = path.toLowerCase();
	if (
		lowered.endsWith(".sh") ||
		lowered.endsWith(".bash") ||
		lowered.endsWith(".zsh")
	) {
		return ["/bin/bash", path];
	}
	if (
		lowered.endsWith(".js") ||
		lowered.endsWith(".mjs") ||
		lowered.endsWith(".cjs")
	) {
		return ["node", path];
	}
	if (
		lowered.endsWith(".ts") ||
		lowered.endsWith(".mts") ||
		lowered.endsWith(".cts")
	) {
		return ["bun", "run", path];
	}
	if (lowered.endsWith(".py")) {
		return ["python3", path];
	}
	// Default to bash for legacy hook files with no extension/shebang.
	return ["/bin/bash", path];
}

function createHookCommandMap(workspacePath: string): HookCommandMap {
	const map: HookCommandMap = {};
	for (const file of listHookConfigFiles(workspacePath)) {
		if (!file.hookEventName) {
			continue;
		}
		const existing = map[file.hookEventName] ?? [];
		existing.push(inferHookCommand(file.path));
		map[file.hookEventName] = existing;
	}
	return map;
}

async function runBlockingHookCommands(options: {
	commands: string[][];
	payload: HookEventPayload;
	cwd: string;
	logger?: BasicLogger;
	timeoutMs?: number;
}): Promise<AgentHookControl | undefined> {
	let merged: AgentHookControl | undefined;
	for (const command of options.commands) {
		const commandLabel = command.join(" ");
		try {
			const result = await runHookCommand(options.payload, {
				command,
				cwd: options.cwd,
				env: process.env,
				detached: false,
				timeoutMs: options.timeoutMs,
			});
			if (result?.timedOut) {
				logHookError(options.logger, `hook command timed out: ${commandLabel}`);
				continue;
			}
			if (result?.parseError) {
				logHookError(
					options.logger,
					`hook command returned invalid JSON control output: ${commandLabel} (${result.parseError})`,
				);
				continue;
			}
			merged = mergeHookControls(merged, parseHookControl(result?.parsedJson));
		} catch (error) {
			logHookError(
				options.logger,
				`hook command failed: ${commandLabel}`,
				error,
			);
		}
	}
	return merged;
}

function runAsyncHookCommands(options: {
	commands: string[][];
	payload: HookEventPayload;
	cwd: string;
	logger?: BasicLogger;
}): void {
	for (const command of options.commands) {
		const commandLabel = command.join(" ");
		void runHookCommand(options.payload, {
			command,
			cwd: options.cwd,
			env: process.env,
			detached: true,
		}).catch((error) => {
			logHookError(
				options.logger,
				`hook command failed: ${commandLabel}`,
				error,
			);
		});
	}
}

export function createHookAuditHooks(options: {
	hookLogPath: string;
	rootSessionId?: string;
	workspacePath: string;
}): AgentHooks {
	const runtimeOptions: HookRuntimeOptions = {
		cwd: options.workspacePath,
		workspacePath: options.workspacePath,
		hookLogPath: options.hookLogPath,
		rootSessionId: options.rootSessionId,
	};

	const append = (payload: HookEventPayload): void => {
		const line = `${JSON.stringify({
			ts: new Date().toISOString(),
			...payload,
		})}\n`;
		ensureHookLogDir(options.hookLogPath);
		appendFileSync(options.hookLogPath, line, "utf8");
	};

	return {
		onRunStart: async (ctx: AgentHookRunStartContext) => {
			append({
				...createPayloadBase(ctx, runtimeOptions),
				hookName: "agent_start",
				taskStart: { taskMetadata: {} },
			});
			append({
				...createPayloadBase(ctx, runtimeOptions),
				hookName: "prompt_submit",
				userPromptSubmit: {
					prompt: ctx.userMessage,
					attachments: [],
				},
			});
			return undefined;
		},
		onToolCallStart: async (ctx: AgentHookToolCallStartContext) => {
			append({
				...createPayloadBase(ctx, runtimeOptions),
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
			});
			return undefined;
		},
		onToolCallEnd: async (ctx: AgentHookToolCallEndContext) => {
			append({
				...createPayloadBase(ctx, runtimeOptions),
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
			});
			return undefined;
		},
		onTurnEnd: async (ctx: AgentHookTurnEndContext) => {
			append({
				...createPayloadBase(ctx, runtimeOptions),
				hookName: "agent_end",
				iteration: ctx.iteration,
				turn: ctx.turn,
				taskComplete: { taskMetadata: {} },
			});
			return undefined;
		},
		onStopError: async (ctx: AgentHookStopErrorContext) => {
			append({
				...createPayloadBase(ctx, runtimeOptions),
				hookName: "agent_error",
				iteration: ctx.iteration,
				error: {
					name: ctx.error.name,
					message: ctx.error.message,
					stack: ctx.error.stack,
				},
			});
			return undefined;
		},
		onSessionShutdown: async (ctx: AgentHookSessionShutdownContext) => {
			if (isAbortReason(ctx.reason)) {
				append({
					...createPayloadBase(ctx, runtimeOptions),
					hookName: "agent_abort",
					reason: ctx.reason,
					taskCancel: { taskMetadata: {} },
				});
			}
			append({
				...createPayloadBase(ctx, runtimeOptions),
				hookName: "session_shutdown",
				reason: ctx.reason,
			});
			return undefined;
		},
	};
}

export function createHookConfigFileHooks(
	options: HookRuntimeOptions,
): AgentHooks | undefined {
	const commandMap = createHookCommandMap(options.workspacePath);
	const hasAnyHooks = Object.values(commandMap).some(
		(paths) => (paths?.length ?? 0) > 0,
	);
	if (!hasAnyHooks) {
		return undefined;
	}

	const runStartPayload = async (
		ctx: AgentHookRunStartContext,
	): Promise<void> => {
		const agentStart = commandMap.agent_start ?? [];
		if (agentStart.length > 0) {
			runAsyncHookCommands({
				commands: agentStart,
				cwd: options.cwd,
				logger: options.logger,
				payload: {
					...createPayloadBase(ctx, options),
					hookName: "agent_start",
					taskStart: { taskMetadata: {} },
				},
			});
		}

		const promptSubmit = commandMap.prompt_submit ?? [];
		if (promptSubmit.length > 0) {
			runAsyncHookCommands({
				commands: promptSubmit,
				cwd: options.cwd,
				logger: options.logger,
				payload: {
					...createPayloadBase(ctx, options),
					hookName: "prompt_submit",
					userPromptSubmit: {
						prompt: ctx.userMessage,
						attachments: [],
					},
				},
			});
		}
	};

	const runToolCallStart = async (
		ctx: AgentHookToolCallStartContext,
	): Promise<AgentHookControl | undefined> => {
		const commandPaths = commandMap.tool_call ?? [];
		if (commandPaths.length === 0) {
			return undefined;
		}
		return runBlockingHookCommands({
			commands: commandPaths,
			cwd: options.cwd,
			logger: options.logger,
			timeoutMs: options.toolCallTimeoutMs ?? 120000,
			payload: {
				...createPayloadBase(ctx, options),
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
		});
	};

	const runToolCallEnd = async (
		ctx: AgentHookToolCallEndContext,
	): Promise<void> => {
		const commandPaths = commandMap.tool_result ?? [];
		if (commandPaths.length === 0) {
			return;
		}
		runAsyncHookCommands({
			commands: commandPaths,
			cwd: options.cwd,
			logger: options.logger,
			payload: {
				...createPayloadBase(ctx, options),
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
		});
	};

	const runTurnEnd = async (ctx: AgentHookTurnEndContext): Promise<void> => {
		const commandPaths = commandMap.agent_end ?? [];
		if (commandPaths.length === 0) {
			return;
		}
		runAsyncHookCommands({
			commands: commandPaths,
			cwd: options.cwd,
			logger: options.logger,
			payload: {
				...createPayloadBase(ctx, options),
				hookName: "agent_end",
				iteration: ctx.iteration,
				turn: ctx.turn,
				taskComplete: { taskMetadata: {} },
			},
		});
	};

	const runStopError = async (
		ctx: AgentHookStopErrorContext,
	): Promise<void> => {
		const commandPaths = commandMap.agent_error ?? [];
		if (commandPaths.length === 0) {
			return;
		}
		runAsyncHookCommands({
			commands: commandPaths,
			cwd: options.cwd,
			logger: options.logger,
			payload: {
				...createPayloadBase(ctx, options),
				hookName: "agent_error",
				iteration: ctx.iteration,
				error: {
					name: ctx.error.name,
					message: ctx.error.message,
					stack: ctx.error.stack,
				},
			},
		});
	};

	const runSessionShutdown = async (
		ctx: AgentHookSessionShutdownContext,
	): Promise<void> => {
		if (isAbortReason(ctx.reason)) {
			const abortCommands = commandMap.agent_abort ?? [];
			if (abortCommands.length > 0) {
				runAsyncHookCommands({
					commands: abortCommands,
					cwd: options.cwd,
					logger: options.logger,
					payload: {
						...createPayloadBase(ctx, options),
						hookName: "agent_abort",
						reason: ctx.reason,
						taskCancel: { taskMetadata: {} },
					},
				});
			}
		}
		const shutdownCommands = commandMap.session_shutdown ?? [];
		if (shutdownCommands.length === 0) {
			return;
		}
		runAsyncHookCommands({
			commands: shutdownCommands,
			cwd: options.cwd,
			logger: options.logger,
			payload: {
				...createPayloadBase(ctx, options),
				hookName: "session_shutdown",
				reason: ctx.reason,
			},
		});
	};

	return {
		onRunStart: async (ctx: AgentHookRunStartContext) => {
			await runStartPayload(ctx);
			return undefined;
		},
		onToolCallStart: async (ctx: AgentHookToolCallStartContext) =>
			runToolCallStart(ctx),
		onToolCallEnd: async (ctx: AgentHookToolCallEndContext) => {
			await runToolCallEnd(ctx);
			return undefined;
		},
		onTurnEnd: async (ctx: AgentHookTurnEndContext) => {
			await runTurnEnd(ctx);
			return undefined;
		},
		onStopError: async (ctx: AgentHookStopErrorContext) => {
			await runStopError(ctx);
			return undefined;
		},
		onSessionShutdown: async (ctx: AgentHookSessionShutdownContext) => {
			await runSessionShutdown(ctx);
			return undefined;
		},
	};
}

function mergeHookFunction<K extends keyof AgentHooks>(
	layers: AgentHooks[],
	key: K,
): AgentHooks[K] | undefined {
	const handlers = layers
		.map((layer) => layer[key])
		.filter((handler) => typeof handler === "function");
	if (handlers.length === 0) {
		return undefined;
	}
	return (async (ctx: unknown) => {
		let control: AgentHookControl | undefined;
		for (const handler of handlers) {
			const next = await (handler as (arg: unknown) => unknown)(ctx);
			control = mergeHookControls(
				control,
				next as AgentHookControl | undefined,
			);
		}
		return control;
	}) as AgentHooks[K];
}

export function mergeAgentHooks(
	layers: Array<AgentHooks | undefined>,
): AgentHooks | undefined {
	const activeLayers = layers.filter(
		(layer): layer is AgentHooks => layer !== undefined,
	);
	if (activeLayers.length === 0) {
		return undefined;
	}

	return {
		onRunStart: mergeHookFunction(activeLayers, "onRunStart"),
		onRunEnd: mergeHookFunction(activeLayers, "onRunEnd"),
		onIterationStart: mergeHookFunction(activeLayers, "onIterationStart"),
		onIterationEnd: mergeHookFunction(activeLayers, "onIterationEnd"),
		onTurnStart: mergeHookFunction(activeLayers, "onTurnStart"),
		onTurnEnd: mergeHookFunction(activeLayers, "onTurnEnd"),
		onToolCallStart: mergeHookFunction(activeLayers, "onToolCallStart"),
		onToolCallEnd: mergeHookFunction(activeLayers, "onToolCallEnd"),
		onSessionShutdown: mergeHookFunction(activeLayers, "onSessionShutdown"),
		onError: mergeHookFunction(activeLayers, "onError"),
	};
}
