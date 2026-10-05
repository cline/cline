import type { ChatRunTurnRequest, HubSessionClient } from "@cline/core";
import { type GeneratedMedia, isGeneratedMedia } from "@cline/shared";
import type { CliLoggerAdapter } from "../logging/adapter";
import { shortenPath } from "../tui/utils/tool-parsing";

export type PendingConnectorApproval = {
	approvalId: string;
	sessionId: string;
	toolCallId: string;
	toolName: string;
	input?: unknown;
};

type QueueItem =
	| { type: "chunk"; value: string }
	| { type: "error"; error: Error }
	| { type: "end" };

export function truncateConnectorText(value: string, maxLength = 160): string {
	const singleLine = value.replace(/\s+/g, " ").trim();
	if (singleLine.length <= maxLength) {
		return singleLine;
	}
	return `${singleLine.slice(0, maxLength - 3)}...`;
}

/** Minimum gap between live-output re-renders of a running tool. */
const PROGRESS_UPDATE_INTERVAL_MS = 1_500;
/**
 * How often a quiet status message is refreshed so a thread stays visibly
 * alive.
 */
const STATUS_HEARTBEAT_INTERVAL_MS = 10_000;
/** Tail of live tool output retained while a tool is running. */
const TOOL_OUTPUT_TAIL_CHARS = 1_600;
/** Portion of the retained tail rendered into the status message. */
const TOOL_OUTPUT_RENDER_CHARS = 600;
/** Finished tool lines kept in the rolling status message. */
const STATUS_HISTORY_LINES = 12;
/**
 * Hard ceiling for the rendered status message. It is edited in place, so it
 * must fit the tightest transport limit (Telegram allows 4096 chars).
 */
const STATUS_MESSAGE_MAX_CHARS = 3_500;
/** Length of the "what this tool is doing" summary line. */
const TOOL_INPUT_SUMMARY_CHARS = 120;
/** Key prefix for tool events that arrive without a toolCallId. */
const FALLBACK_TOOL_KEY_PREFIX = "hook-tool-";
/**
 * `tool.finished` reaches connectors twice for the same call: once from the
 * agent-event projection (with a toolCallId) and once from the hook projection
 * (name only). A completion recorded within this window is not repeated.
 */
const COMPLETION_DEDUPE_WINDOW_MS = 5_000;

export type ConnectorToolStatusKind =
	| "start"
	| "progress"
	| "error"
	| "complete";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function withMoreItems(primary: string, total: number): string {
	return total > 1 ? `${primary} +${total - 1} more` : primary;
}

/** Human-readable duration (`12s`, `1m05s`) for status messages. */
export function formatConnectorElapsed(
	elapsedMs: number | undefined,
): string | undefined {
	if (elapsedMs === undefined || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
		return undefined;
	}
	const totalSeconds = Math.floor(elapsedMs / 1000);
	if (totalSeconds < 60) {
		return `${totalSeconds}s`;
	}
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

export function parseToolApprovalInput(inputJson: unknown): unknown {
	if (typeof inputJson !== "string" || !inputJson.trim()) {
		return undefined;
	}
	try {
		return JSON.parse(inputJson);
	} catch {
		return undefined;
	}
}

function resolveCommandList(input: Record<string, unknown>): string[] {
	const raw = input.commands;
	if (typeof raw === "string") {
		return raw.trim() ? [raw.trim()] : [];
	}
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw
		.map((entry) => {
			if (typeof entry === "string") {
				return entry.trim();
			}
			if (!isPlainRecord(entry) || typeof entry.command !== "string") {
				return "";
			}
			const args = Array.isArray(entry.args)
				? entry.args
						.filter((arg): arg is string => typeof arg === "string")
						.join(" ")
						.trim()
				: "";
			const command = entry.command.trim();
			return args ? `${command} ${args}` : command;
		})
		.filter((command) => command.length > 0);
}

function resolvePathList(input: Record<string, unknown>): string[] {
	if (typeof input.path === "string" && input.path.trim()) {
		return [input.path.trim()];
	}
	if (Array.isArray(input.file_paths)) {
		return input.file_paths
			.filter(
				(path): path is string => typeof path === "string" && !!path.trim(),
			)
			.map((path) => path.trim());
	}
	if (Array.isArray(input.files)) {
		return input.files
			.filter(isPlainRecord)
			.map((file) => (typeof file.path === "string" ? file.path.trim() : ""))
			.filter((path) => path.length > 0);
	}
	return [];
}

function resolveUrlList(input: Record<string, unknown>): string[] {
	if (typeof input.url === "string" && input.url.trim()) {
		return [input.url.trim()];
	}
	if (Array.isArray(input.requests)) {
		return input.requests
			.filter(isPlainRecord)
			.map((request) =>
				typeof request.url === "string" ? request.url.trim() : "",
			)
			.filter((url) => url.length > 0);
	}
	return [];
}

function resolveQueryList(input: Record<string, unknown>): string[] {
	const queries = Array.isArray(input.queries)
		? input.queries
		: typeof input.query === "string"
			? [input.query]
			: [];
	return queries
		.filter(
			(query): query is string => typeof query === "string" && !!query.trim(),
		)
		.map((query) => query.trim());
}

function resolveFirstStringField(
	input: Record<string, unknown>,
): string | undefined {
	for (const value of Object.values(input)) {
		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
	}
	return undefined;
}

function formatToolInput(toolName: string | undefined, input: unknown): string {
	if (input === undefined) {
		return toolName?.trim() || "";
	}
	try {
		const serialized = JSON.stringify(input);
		if (!serialized) {
			return toolName?.trim() || "";
		}
		return toolName?.trim() ? `${toolName.trim()} ${serialized}` : serialized;
	} catch {
		return toolName?.trim() || "";
	}
}

/**
 * One-line "what is this tool actually doing" summary, so connector status
 * messages report `run_commands: npm test` instead of a bare tool name.
 *
 * Driven by input field shapes rather than a tool-name table, so unknown and
 * MCP tools still get a useful summary.
 */
export function summarizeConnectorToolInput(
	input: unknown,
): string | undefined {
	if (typeof input === "string") {
		return input.trim() || undefined;
	}
	if (!isPlainRecord(input)) {
		return undefined;
	}

	const commands = resolveCommandList(input);
	if (commands.length > 0) {
		return withMoreItems(
			truncateConnectorText(commands[0] ?? "", TOOL_INPUT_SUMMARY_CHARS),
			commands.length,
		);
	}
	const paths = resolvePathList(input);
	if (paths.length > 0) {
		return withMoreItems(shortenPath(paths[0] ?? "", 80), paths.length);
	}
	const urls = resolveUrlList(input);
	if (urls.length > 0) {
		return withMoreItems(
			truncateConnectorText(urls[0] ?? "", TOOL_INPUT_SUMMARY_CHARS),
			urls.length,
		);
	}
	const queries = resolveQueryList(input);
	if (queries.length > 0) {
		return withMoreItems(
			truncateConnectorText(queries[0] ?? "", TOOL_INPUT_SUMMARY_CHARS),
			queries.length,
		);
	}
	const scalar = resolveFirstStringField(input);
	if (scalar) {
		return truncateConnectorText(scalar, TOOL_INPUT_SUMMARY_CHARS);
	}
	try {
		const serialized = JSON.stringify(input);
		return serialized
			? truncateConnectorText(serialized, TOOL_INPUT_SUMMARY_CHARS)
			: undefined;
	} catch {
		return undefined;
	}
}

/**
 * Displayable text from a `tool.updated` payload. The bash executor streams
 * `{ stream, chunk }` progress frames; other tools may emit plain strings.
 */
export function extractConnectorToolProgress(
	update: unknown,
): string | undefined {
	if (typeof update === "string") {
		return update || undefined;
	}
	if (!isPlainRecord(update)) {
		return undefined;
	}
	if (typeof update.chunk === "string" && update.chunk) {
		return update.chunk;
	}
	if (typeof update.text === "string" && update.text) {
		return update.text;
	}
	return undefined;
}

export function formatConnectorToolStatus(input: {
	toolName: string | undefined;
	status: ConnectorToolStatusKind;
	toolInput?: unknown;
	errorMessage?: string;
	outputTail?: string;
	elapsedMs?: number;
}): string {
	const resolvedName = input.toolName?.trim() || "unknown_tool";
	const summary = summarizeConnectorToolInput(input.toolInput);
	const elapsed = formatConnectorElapsed(input.elapsedMs);
	const target = summary ? `${resolvedName}: ${summary}` : resolvedName;

	if (input.status === "error") {
		const detail = input.errorMessage?.trim();
		const suffix = elapsed ? ` after ${elapsed}` : "";
		return detail
			? `${resolvedName} failed${suffix}: ${truncateConnectorText(detail, 240)}`
			: `${resolvedName} failed${suffix}`;
	}

	if (input.status === "complete") {
		return elapsed
			? `Completed ${target} in ${elapsed}`
			: `Completed ${target}`;
	}

	const running = elapsed
		? `Executing ${target} (${elapsed})`
		: `Executing ${target}...`;
	const tail = input.outputTail?.trim();
	if (!tail) {
		return running;
	}
	return `${running}\n\`\`\`\n${tail}\n\`\`\``;
}

export function formatConnectorApprovalPrompt(
	input: PendingConnectorApproval,
): string {
	const summary = formatToolInput(input.toolName, input.input);
	return summary
		? [
				`Approval required for "${input.toolName}"`,
				`Request: ${truncateConnectorText(summary, 220)}`,
				'Reply "Y" to approve or "N" to deny.',
			].join("\n")
		: [
				`Approval required for "${input.toolName}"`,
				'Reply "Y" to approve or "N" to deny.',
			].join("\n");
}

export function parseConnectorApprovalDecision(
	text: string,
	deniedReason = "Denied by user",
): { approved: boolean; reason?: string } | undefined {
	const normalized = text.trim().toLowerCase();
	if (
		normalized === "y" ||
		normalized === "yes" ||
		normalized === "approve" ||
		normalized === "approved"
	) {
		return { approved: true };
	}
	if (
		normalized === "n" ||
		normalized === "no" ||
		normalized === "deny" ||
		normalized === "denied"
	) {
		return { approved: false, reason: deniedReason };
	}
	return undefined;
}

function resolveTextDelta(
	payload: Record<string, unknown>,
	previous: string,
): { delta: string; nextText: string } {
	const accumulated =
		typeof payload.accumulated === "string" ? payload.accumulated : undefined;
	if (typeof accumulated === "string") {
		if (accumulated.startsWith(previous)) {
			return {
				delta: accumulated.slice(previous.length),
				nextText: accumulated,
			};
		}
		if (previous.startsWith(accumulated)) {
			return {
				delta: "",
				nextText: previous,
			};
		}
	}
	const text = typeof payload.text === "string" ? payload.text : "";
	return {
		delta: text,
		nextText: `${previous}${text}`,
	};
}

export function createConnectorRuntimeTurnStream(input: {
	client: HubSessionClient;
	sessionId: string;
	request: ChatRunTurnRequest;
	clientId: string;
	logger: CliLoggerAdapter;
	transport: string;
	conversationId: string;
	onToolStatus?: (message: string) => Promise<void>;
	onApprovalRequested?: (approval: PendingConnectorApproval) => Promise<void>;
	onMedia?: (media: GeneratedMedia) => Promise<void> | void;
	onCompleted?: (result: {
		text: string;
		finishReason?: string;
		iterations?: number;
	}) => Promise<void>;
	onFailed?: (error: Error) => Promise<void>;
	/** Minimum gap between live tool-output status renders. Defaults to 1.5s. */
	progressUpdateIntervalMs?: number;
	/** How often a quiet status message is refreshed. Defaults to 10s. */
	statusHeartbeatIntervalMs?: number;
}): AsyncIterable<string> {
	type ActiveConnectorTool = {
		toolCallId: string;
		toolName: string | undefined;
		toolInput: unknown;
		startedAt: number;
		lastPostedAt: number;
		outputTail: string;
	};

	const progressIntervalMs = Math.max(
		0,
		input.progressUpdateIntervalMs ?? PROGRESS_UPDATE_INTERVAL_MS,
	);
	const heartbeatIntervalMs = Math.max(
		250,
		input.statusHeartbeatIntervalMs ?? STATUS_HEARTBEAT_INTERVAL_MS,
	);

	return {
		[Symbol.asyncIterator]: async function* () {
			const queue: QueueItem[] = [];
			let notify: (() => void) | undefined;
			let streamedText = "";
			let closed = false;
			let failed = false;
			const activeTools = new Map<string, ActiveConnectorTool>();
			const completedLines: string[] = [];
			let iterationLine = "";
			let renderedStatus = "";
			let pendingStatus: string | undefined;
			let statusDraining = false;
			let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
			let fallbackToolKey = 0;
			/** Last time a completion line was recorded, keyed by tool name. */
			const recentCompletions = new Map<string, number>();

			const push = (item: QueueItem) => {
				queue.push(item);
				notify?.();
				notify = undefined;
			};

			/**
			 * Delivers queued status renders one at a time. Runs until the queue is
			 * empty so anything posted while a `chat.update` is in flight is still
			 * picked up by the same loop.
			 */
			const drainStatus = async (): Promise<void> => {
				statusDraining = true;
				try {
					for (;;) {
						const message = pendingStatus;
						if (message === undefined) {
							return;
						}
						pendingStatus = undefined;
						renderedStatus = message;
						try {
							await input.onToolStatus?.(message);
						} catch (error) {
							input.logger.core.log("Connector tool status delivery failed", {
								severity: "warn",
								transport: input.transport,
								conversationId: input.conversationId,
								sessionId: input.sessionId,
								error,
							});
						}
					}
				} finally {
					statusDraining = false;
				}
			};

			/**
			 * Queues a status render. Only the latest pending render survives, so a
			 * burst of tool events collapses into one message edit instead of
			 * competing `chat.update` calls racing each other.
			 */
			const postStatus = (message: string): void => {
				if (!input.onToolStatus || closed) {
					return;
				}
				if (!message.trim() || message === renderedStatus) {
					return;
				}
				pendingStatus = message;
				if (statusDraining) {
					// The in-flight drain loop re-reads pendingStatus before it exits,
					// so the newest render is never dropped.
					return;
				}
				void drainStatus();
			};

			const renderStatusMessage = (now: number): string => {
				const render = (history: string[], tailChars: number): string => {
					const activeLines = [...activeTools.values()].map((tool) =>
						formatConnectorToolStatus({
							toolName: tool.toolName,
							status: "progress",
							toolInput: tool.toolInput,
							outputTail:
								tailChars > 0 && tool.outputTail
									? tool.outputTail.slice(-tailChars)
									: undefined,
							elapsedMs: now - tool.startedAt,
						}),
					);
					return [...history, ...activeLines, iterationLine]
						.filter((line) => !!line.trim())
						.join("\n");
				};

				// The status message is edited in place, so it has to stay inside the
				// tightest transport limit (Telegram caps a message at 4096 chars).
				// Shrink by dropping the oldest finished tools first, then the live
				// output tail, rather than letting the edit fail.
				let history = completedLines;
				const tailChars = TOOL_OUTPUT_RENDER_CHARS;
				let message = render(history, tailChars);
				while (
					message.length > STATUS_MESSAGE_MAX_CHARS &&
					history.length > 0
				) {
					history = history.slice(1);
					message = render(history, tailChars);
				}
				if (message.length > STATUS_MESSAGE_MAX_CHARS && tailChars > 0) {
					message = render(history, 0);
				}
				if (message.length > STATUS_MESSAGE_MAX_CHARS) {
					message = `${message.slice(0, STATUS_MESSAGE_MAX_CHARS - 1)}…`;
				}
				return message;
			};

			const refreshStatus = (): void => {
				postStatus(renderStatusMessage(Date.now()));
			};

			const recordCompletedLine = (line: string): void => {
				if (!line.trim()) {
					return;
				}
				completedLines.push(line);
				if (completedLines.length > STATUS_HISTORY_LINES) {
					completedLines.splice(
						0,
						completedLines.length - STATUS_HISTORY_LINES,
					);
				}
			};

			const stopHeartbeat = (): void => {
				if (!heartbeatTimer) {
					return;
				}
				clearInterval(heartbeatTimer);
				heartbeatTimer = undefined;
			};

			/**
			 * Re-renders the status message while a tool runs so the elapsed timer
			 * keeps ticking even when the tool itself is silent (a long test run, a
			 * slow network call).
			 */
			const ensureHeartbeat = (): void => {
				if (heartbeatTimer || !input.onToolStatus) {
					return;
				}
				heartbeatTimer = setInterval(() => {
					if (activeTools.size === 0) {
						stopHeartbeat();
						return;
					}
					refreshStatus();
				}, heartbeatIntervalMs);
				heartbeatTimer.unref();
			};

			const resolveActiveTool = (
				toolCallId: unknown,
				toolName?: string,
			): ActiveConnectorTool | undefined => {
				if (typeof toolCallId === "string" && toolCallId.trim()) {
					const match = activeTools.get(toolCallId.trim());
					if (match) {
						return match;
					}
				}
				// Hook-projected tool events omit toolCallId, so fall back to a
				// name match and then to the only running tool. Progress must never
				// be dropped just because an identifier is missing.
				const named = [...activeTools.values()].find(
					(tool) => tool.toolName === toolName,
				);
				if (named) {
					return named;
				}
				return activeTools.size === 1
					? [...activeTools.values()][0]
					: undefined;
			};

			const stopStreaming = input.client.streamEvents(
				{
					clientId: input.clientId,
					sessionIds: [input.sessionId],
				},
				{
					onEvent: (event) => {
						if (event.eventType === "runtime.chat.media") {
							const media = event.payload.media;
							if (isGeneratedMedia(media)) {
								void input.onMedia?.(media);
							}
							return;
						}
						if (event.eventType === "approval.requested") {
							const approvalId =
								typeof event.payload.approvalId === "string"
									? event.payload.approvalId.trim()
									: "";
							const toolCallId =
								typeof event.payload.toolCallId === "string"
									? event.payload.toolCallId.trim()
									: "";
							const toolName =
								typeof event.payload.toolName === "string"
									? event.payload.toolName.trim()
									: "";
							if (!approvalId || !toolCallId || !toolName) {
								return;
							}
							void input.onApprovalRequested?.({
								approvalId,
								sessionId: input.sessionId,
								toolCallId,
								toolName,
								input: parseToolApprovalInput(event.payload.inputJson),
							});
							return;
						}
						if (event.eventType === "runtime.chat.iteration_start") {
							const iteration =
								typeof event.payload.iteration === "number"
									? event.payload.iteration
									: undefined;
							if (!iteration || iteration < 2 || activeTools.size > 0) {
								return;
							}
							iterationLine = `Thinking (step ${iteration})...`;
							refreshStatus();
							return;
						}
						if (event.eventType === "runtime.chat.tool_call_start") {
							const toolName =
								typeof event.payload.toolName === "string"
									? event.payload.toolName
									: undefined;
							const rawToolCallId =
								typeof event.payload.toolCallId === "string"
									? event.payload.toolCallId.trim()
									: "";
							const now = Date.now();
							if (
								!rawToolCallId &&
								[...activeTools.values()].some(
									(tool) => tool.toolName === toolName,
								)
							) {
								// Hook-projected `tool.started` events omit toolCallId and
								// duplicate the agent event for the same call.
								return;
							}
							const toolCallId =
								rawToolCallId ||
								`${FALLBACK_TOOL_KEY_PREFIX}${++fallbackToolKey}`;
							if (activeTools.has(toolCallId)) {
								return;
							}
							// Adopt an unidentified entry when the hook event won the race.
							const unidentified = [...activeTools.entries()].find(
								([key, tool]) =>
									key.startsWith(FALLBACK_TOOL_KEY_PREFIX) &&
									tool.toolName === toolName,
							);
							if (unidentified) {
								activeTools.delete(unidentified[0]);
							}
							const previous = unidentified?.[1];
							activeTools.set(toolCallId, {
								toolCallId,
								toolName,
								toolInput: previous?.toolInput ?? event.payload.input,
								startedAt: previous?.startedAt ?? now,
								lastPostedAt: now,
								outputTail: previous?.outputTail ?? "",
							});
							iterationLine = "";
							ensureHeartbeat();
							refreshStatus();
							return;
						}
						if (event.eventType === "runtime.chat.tool_call_update") {
							const tool = resolveActiveTool(event.payload.toolCallId);
							if (!tool) {
								return;
							}
							const chunk = extractConnectorToolProgress(event.payload.update);
							if (!chunk) {
								return;
							}
							const nextTail = `${tool.outputTail}${chunk}`;
							tool.outputTail =
								nextTail.length > TOOL_OUTPUT_TAIL_CHARS
									? nextTail.slice(-TOOL_OUTPUT_TAIL_CHARS)
									: nextTail;
							const now = Date.now();
							if (now - tool.lastPostedAt < progressIntervalMs) {
								return;
							}
							tool.lastPostedAt = now;
							refreshStatus();
							return;
						}
						if (event.eventType === "runtime.chat.tool_call_end") {
							const endToolName =
								typeof event.payload.toolName === "string"
									? event.payload.toolName
									: undefined;
							const tool = resolveActiveTool(
								event.payload.toolCallId,
								endToolName,
							);
							const now = Date.now();
							const completionKey = (
								tool?.toolName ??
								endToolName ??
								""
							).trim();
							const lastCompletedAt = completionKey
								? recentCompletions.get(completionKey)
								: undefined;
							if (
								!tool &&
								lastCompletedAt !== undefined &&
								now - lastCompletedAt < COMPLETION_DEDUPE_WINDOW_MS
							) {
								// The other projection already reported this completion.
								return;
							}
							if (completionKey) {
								recentCompletions.set(completionKey, now);
							}
							const errorMessage =
								typeof event.payload.error === "string" &&
								event.payload.error.trim()
									? event.payload.error
									: undefined;
							recordCompletedLine(
								formatConnectorToolStatus({
									toolName: tool?.toolName ?? endToolName,
									status: errorMessage ? "error" : "complete",
									toolInput: tool?.toolInput ?? event.payload.input,
									errorMessage,
									elapsedMs: tool ? now - tool.startedAt : undefined,
								}),
							);
							if (tool) {
								activeTools.delete(tool.toolCallId);
							}
							if (activeTools.size === 0) {
								stopHeartbeat();
							}
							refreshStatus();
							return;
						}
						if (event.eventType !== "runtime.chat.text_delta") {
							if (event.eventType === "runtime.chat.failed") {
								failed = true;
								const message =
									typeof event.payload.error === "string" &&
									event.payload.error.trim()
										? event.payload.error.trim()
										: "Runtime turn failed";
								const error = new Error(message);
								void input.onFailed?.(error);
								push({ type: "error", error });
							}
							return;
						}
						const resolved = resolveTextDelta(event.payload, streamedText);
						streamedText = resolved.nextText;
						if (iterationLine) {
							iterationLine = "";
							refreshStatus();
						}
						if (resolved.delta) {
							push({ type: "chunk", value: resolved.delta });
						}
					},
					onError: (error) => {
						input.logger.core.log(
							"Connector runtime event stream failed mid-turn",
							{
								severity: "warn",
								transport: input.transport,
								conversationId: input.conversationId,
								sessionId: input.sessionId,
								error,
							},
						);
						push({ type: "error", error });
					},
				},
			);

			const runTurn = input.client
				.sendRuntimeSession(input.sessionId, input.request, { timeoutMs: null })
				.then(async (response) => {
					if (!response.result) {
						input.logger.core.log("Connector runtime turn queued", {
							transport: input.transport,
							conversationId: input.conversationId,
							sessionId: input.sessionId,
						});
						return;
					}
					if (failed) {
						return;
					}
					const finalText = response.result.text ?? "";
					await input.onCompleted?.({
						text: finalText,
						finishReason: response.result.finishReason,
						iterations: response.result.iterations,
					});
					if (finalText?.startsWith(streamedText)) {
						const remainder = finalText.slice(streamedText.length);
						if (remainder) {
							push({ type: "chunk", value: remainder });
						}
					}
				})
				.catch(async (error) => {
					if (failed) {
						return;
					}
					const resolved =
						error instanceof Error ? error : new Error(String(error));
					await input.onFailed?.(resolved);
					push({ type: "error", error: resolved });
				})
				.finally(() => {
					stopHeartbeat();
					stopStreaming();
					push({ type: "end" });
				});

			try {
				while (!closed) {
					if (queue.length === 0) {
						await new Promise<void>((resolve) => {
							notify = resolve;
						});
					}
					const item = queue.shift();
					if (!item) {
						continue;
					}
					if (item.type === "chunk") {
						yield item.value;
						continue;
					}
					if (item.type === "error") {
						throw item.error;
					}
					closed = true;
				}
			} finally {
				stopHeartbeat();
				stopStreaming();
				await runTurn.catch(() => {});
			}
		},
	};
}
