/**
 * Tool Execution
 *
 * Functions for executing tools with error handling, timeouts, and retries.
 */

import type { Tool, ToolCallRecord, ToolContext } from "@clinebot/shared";
import type { PendingToolCall } from "../types";

export interface ToolExecutionObserver {
	onToolCallStart?: (call: PendingToolCall) => Promise<void> | void;
	onToolCallUpdate?: (
		call: PendingToolCall,
		update: unknown,
	) => Promise<void> | void;
	onToolCallEnd?: (record: ToolCallRecord) => Promise<void> | void;
}

export type AuthorizationResult =
	| { allowed: true; overrideInput?: unknown }
	| { allowed: false; reason: string };

export interface ToolExecutionAuthorizer {
	authorize?: (
		call: PendingToolCall,
		context: ToolContext,
	) => Promise<AuthorizationResult> | AuthorizationResult;
}

export interface ToolExecutionOptions {
	maxConcurrency?: number;
}

/**
 * Map `items` to results with at most `concurrency` async workers in flight.
 * `results[i]` always corresponds to `items[i]` (order is preserved).
 * On first failure, no new items are started, but in-flight work is awaited
 * before rejecting so callers do not observe post-rejection side effects.
 */
async function mapWithConcurrency<T, R>(
	items: readonly T[],
	concurrency: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	if (items.length === 0) {
		return [];
	}
	const results = new Array<R>(items.length);
	const max = Math.max(1, concurrency);
	const workerCount = Math.min(max, items.length);
	let nextIndex = 0;
	let firstError: unknown;
	await Promise.all(
		Array.from({ length: workerCount }, async () => {
			while (firstError === undefined) {
				const index = nextIndex++;
				if (index >= items.length) {
					return;
				}
				try {
					results[index] = await fn(items[index]!, index);
				} catch (error) {
					firstError ??= error;
					return;
				}
			}
		}),
	);
	if (firstError !== undefined) {
		throw firstError;
	}
	return results;
}

/**
 * Execute a single tool with error handling and timeout
 *
 * @param tool - The tool to execute
 * @param input - The input to pass to the tool
 * @param context - The execution context
 * @returns A record of the tool call execution
 */
export async function executeTool(
	tool: Tool,
	input: unknown,
	context: ToolContext,
	onChange?: (update: unknown) => void,
): Promise<{ output: unknown; error?: string; durationMs: number }> {
	const startTime = Date.now();
	const timeoutMs = tool.timeoutMs ?? 30000;
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	let abortHandler: (() => void) | undefined;

	// Create a timeout promise
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => {
			reject(new Error(`Tool execution timed out after ${timeoutMs}ms`));
		}, timeoutMs);
	});

	// Create abort handling
	const abortPromise = context.abortSignal
		? new Promise<never>((_, reject) => {
				if (context.abortSignal?.aborted) {
					reject(new Error("Tool execution was aborted"));
					return;
				}
				abortHandler = () => {
					reject(new Error("Tool execution was aborted"));
				};
				context.abortSignal?.addEventListener("abort", abortHandler);
			})
		: null;

	try {
		// Execute with timeout and optional abort
		const promises: Promise<unknown>[] = [
			tool.execute(input, context, onChange),
			timeoutPromise,
		];
		if (abortPromise) {
			promises.push(abortPromise);
		}

		const output = await Promise.race(promises);
		const durationMs = Date.now() - startTime;

		return { output, durationMs };
	} catch (error) {
		const durationMs = Date.now() - startTime;
		const errorMessage = error instanceof Error ? error.message : String(error);

		return { output: null, error: errorMessage, durationMs };
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
		if (context.abortSignal && abortHandler) {
			context.abortSignal.removeEventListener("abort", abortHandler);
		}
	}
}

/**
 * Execute a tool with retries
 */
export async function executeToolWithRetry(
	tool: Tool,
	input: unknown,
	context: ToolContext,
	onChange?: (update: unknown) => void,
): Promise<{ output: unknown; error?: string; durationMs: number }> {
	const maxRetries = tool.maxRetries ?? 2;
	let lastResult: {
		output: unknown;
		error?: string;
		durationMs: number;
	} | null = null;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		// Check for abort before each attempt
		if (context.abortSignal?.aborted) {
			return {
				output: null,
				error: "Tool execution was aborted",
				durationMs: lastResult?.durationMs ?? 0,
			};
		}

		const result = await executeTool(tool, input, context, onChange);
		lastResult = result;

		// If no error, return immediately
		if (!result.error) {
			return result;
		}

		// If tool is not retryable or we've exhausted retries, return the error
		if (!tool.retryable || attempt === maxRetries) {
			return result;
		}

		// Wait a bit before retrying (exponential backoff)
		const delayMs = Math.min(1000 * 2 ** attempt, 10000);
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}

	return lastResult!;
}

/**
 * Execute multiple tools in parallel
 *
 * @param toolRegistry - Map of tools by name
 * @param calls - Array of tool calls to execute
 * @param context - The execution context
 * @returns Array of tool call records
 */
export async function executeToolsInParallel(
	toolRegistry: Map<string, Tool>,
	calls: PendingToolCall[],
	context: ToolContext,
	observer?: ToolExecutionObserver,
	authorizer?: ToolExecutionAuthorizer,
	options?: ToolExecutionOptions,
): Promise<ToolCallRecord[]> {
	// Phase 1: Run all onToolCallStart hooks + authorization in parallel (unbounded).
	// These are fast coordination calls and must not be throttled by the execution
	// concurrency cap — hooks can mutate call.input and call.review before execution.
	const prepared = await Promise.all(
		calls.map(async (call) => {
			await observer?.onToolCallStart?.(call);
			const authorization = await authorizer?.authorize?.(call, context);
			return { call, authorization };
		}),
	);

	// Phase 2: Execute tools with concurrency cap applied only to tool.execute().
	const maxConcurrency = options?.maxConcurrency ?? calls.length;
	return mapWithConcurrency(
		prepared,
		maxConcurrency,
		async ({ call, authorization }) => {
			const startedAt = new Date();
			const tool = toolRegistry.get(call.name);

			if (!tool) {
				const endedAt = new Date();
				const record = {
					id: call.id,
					name: call.name,
					input: call.input,
					output: null,
					error: `Unknown tool: ${call.name}`,
					durationMs: endedAt.getTime() - startedAt.getTime(),
					startedAt,
					endedAt,
				};
				await observer?.onToolCallEnd?.(record);
				return record;
			}

			if (authorization && !authorization.allowed) {
				const endedAt = new Date();
				const record = {
					id: call.id,
					name: call.name,
					input: call.input,
					output: null,
					error: authorization.reason,
					durationMs: endedAt.getTime() - startedAt.getTime(),
					startedAt,
					endedAt,
				};
				await observer?.onToolCallEnd?.(record);
				return record;
			}

			const effectiveInput =
				authorization?.overrideInput !== undefined
					? authorization.overrideInput
					: call.input;
			const { onToolCallUpdate } = observer ?? {};
			const onChange = onToolCallUpdate
				? (update: unknown) => onToolCallUpdate(call, update)
				: undefined;
			const result = await executeToolWithRetry(
				tool,
				effectiveInput,
				context,
				onChange,
			);
			const endedAt = new Date();
			const record = {
				id: call.id,
				name: call.name,
				input: effectiveInput,
				output: result.output,
				error: result.error,
				durationMs: result.durationMs,
				startedAt,
				endedAt,
			};
			await observer?.onToolCallEnd?.(record);
			return record;
		},
	);
}

/**
 * Execute tools sequentially (for cases where order matters)
 */
export async function executeToolsSequentially(
	toolRegistry: Map<string, Tool>,
	calls: PendingToolCall[],
	context: ToolContext,
	observer?: ToolExecutionObserver,
	authorizer?: ToolExecutionAuthorizer,
): Promise<ToolCallRecord[]> {
	const results: ToolCallRecord[] = [];

	for (const call of calls) {
		// Check for abort before each tool
		if (context.abortSignal?.aborted) {
			break;
		}

		const startedAt = new Date();
		await observer?.onToolCallStart?.(call);
		const tool = toolRegistry.get(call.name);

		if (!tool) {
			const endedAt = new Date();
			const record = {
				id: call.id,
				name: call.name,
				input: call.input,
				output: null,
				error: `Unknown tool: ${call.name}`,
				durationMs: endedAt.getTime() - startedAt.getTime(),
				startedAt,
				endedAt,
			};
			await observer?.onToolCallEnd?.(record);
			results.push(record);
			continue;
		}

		const authorization = await authorizer?.authorize?.(call, context);
		if (authorization && !authorization.allowed) {
			const endedAt = new Date();
			const record = {
				id: call.id,
				name: call.name,
				input: call.input,
				output: null,
				error: authorization.reason,
				durationMs: endedAt.getTime() - startedAt.getTime(),
				startedAt,
				endedAt,
			};
			await observer?.onToolCallEnd?.(record);
			results.push(record);
			continue;
		}

		const effectiveInput =
			authorization?.overrideInput !== undefined
				? authorization.overrideInput
				: call.input;
		const { onToolCallUpdate } = observer ?? {};
		const onChange = onToolCallUpdate
			? (update: unknown) => onToolCallUpdate(call, update)
			: undefined;
		const result = await executeToolWithRetry(
			tool,
			effectiveInput,
			context,
			onChange,
		);
		const endedAt = new Date();

		const record = {
			id: call.id,
			name: call.name,
			input: effectiveInput,
			output: result.output,
			error: result.error,
			durationMs: result.durationMs,
			startedAt,
			endedAt,
		};
		await observer?.onToolCallEnd?.(record);
		results.push(record);
	}

	return results;
}
