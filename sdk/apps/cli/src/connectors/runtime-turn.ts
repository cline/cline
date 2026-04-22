import type { ChatRunTurnRequest, HubSessionClient } from "@clinebot/core";
import type { CliLoggerAdapter } from "../logging/adapter";

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

export function formatConnectorToolStatus(input: {
	toolName: string | undefined;
	status: "start" | "error";
	toolInput?: unknown;
	errorMessage?: string;
}): string {
	const resolvedName = input.toolName?.trim() || "unknown_tool";
	if (input.status === "start") {
		return `Executing ${resolvedName}...`;
	}
	const detail = input.errorMessage?.trim();
	return detail
		? `${resolvedName} failed: ${truncateConnectorText(detail, 240)}`
		: `${resolvedName} failed`;
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
	onCompleted?: (result: {
		text: string;
		finishReason?: string;
		iterations?: number;
	}) => Promise<void>;
	onFailed?: (error: Error) => Promise<void>;
}): AsyncIterable<string> {
	let lastStatusMessage = "";

	return {
		[Symbol.asyncIterator]: async function* () {
			const queue: QueueItem[] = [];
			let notify: (() => void) | undefined;
			let streamedText = "";
			let closed = false;

			const push = (item: QueueItem) => {
				queue.push(item);
				notify?.();
				notify = undefined;
			};

			const postStatus = async (message: string): Promise<void> => {
				if (!message || message === lastStatusMessage) {
					return;
				}
				lastStatusMessage = message;
				await input.onToolStatus?.(message);
			};

			const stopStreaming = input.client.streamEvents(
				{
					clientId: input.clientId,
					sessionIds: [input.sessionId],
				},
				{
					onEvent: (event) => {
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
						if (event.eventType === "runtime.chat.tool_call_start") {
							void postStatus(
								formatConnectorToolStatus({
									toolName:
										typeof event.payload.toolName === "string"
											? event.payload.toolName
											: undefined,
									status: "start",
									toolInput: event.payload.input,
								}),
							);
							return;
						}
						if (event.eventType === "runtime.chat.tool_call_end") {
							if (
								typeof event.payload.error === "string" &&
								event.payload.error.trim()
							) {
								void postStatus(
									formatConnectorToolStatus({
										toolName:
											typeof event.payload.toolName === "string"
												? event.payload.toolName
												: undefined,
										status: "error",
										errorMessage: event.payload.error,
									}),
								);
							}
							return;
						}
						if (event.eventType !== "runtime.chat.text_delta") {
							return;
						}
						const resolved = resolveTextDelta(event.payload, streamedText);
						streamedText = resolved.nextText;
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
				.sendRuntimeSession(input.sessionId, input.request)
				.then(async (response) => {
					if (!response.result) {
						throw new Error("connector runtime turn unexpectedly queued");
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
					const resolved =
						error instanceof Error ? error : new Error(String(error));
					await input.onFailed?.(resolved);
					push({ type: "error", error: resolved });
				})
				.finally(() => {
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
				stopStreaming();
				await runTurn.catch(() => {});
			}
		},
	};
}
