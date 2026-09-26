import type { ChatRunTurnRequest, HubSessionClient } from "@cline/core";
import { type GeneratedMedia, isGeneratedMedia } from "@cline/shared";
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

export function createConnectorRuntimeTurnStream(input: {
	client: HubSessionClient;
	sessionId: string;
	request: ChatRunTurnRequest;
	clientId: string;
	logger: CliLoggerAdapter;
	transport: string;
	conversationId: string;
	onApprovalRequested?: (approval: PendingConnectorApproval) => Promise<void>;
	onMedia?: (media: GeneratedMedia) => Promise<void> | void;
	onCompleted?: (result: {
		text: string;
		finishReason?: string;
		iterations?: number;
	}) => Promise<void>;
	onFailed?: (error: Error) => Promise<void>;
}): AsyncIterable<string> {
	return {
		[Symbol.asyncIterator]: async function* () {
			const queue: QueueItem[] = [];
			let notify: (() => void) | undefined;
			let pendingSubmission: string | undefined;
			let submittedText: string | undefined;
			let closed = false;
			let failed = false;

			const push = (item: QueueItem) => {
				queue.push(item);
				notify?.();
				notify = undefined;
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
						if (event.eventType === "runtime.chat.tool_call_start") {
							if (event.payload.toolName === "submit_and_exit") {
								const rawInput = event.payload.input;
								const input =
									typeof rawInput === "string"
										? parseToolApprovalInput(rawInput)
										: rawInput;
								const summary =
									typeof input === "object" && input !== null &&
									typeof (input as { summary?: unknown }).summary === "string"
										? (input as { summary: string }).summary.trim()
										: "";
								pendingSubmission = summary || undefined;
							}
							return;
						}
						if (event.eventType === "runtime.chat.tool_call_end") {
							if (event.payload.toolName === "submit_and_exit") {
								const hasError = Boolean(
									typeof event.payload.error === "string" &&
										event.payload.error.trim(),
								);
								if (!hasError && pendingSubmission) {
									submittedText = pendingSubmission;
									push({ type: "chunk", value: pendingSubmission });
								}
								pendingSubmission = undefined;
							}
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
						// Assistant narration is intentionally hidden in connector chats.
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
					await input.onCompleted?.({
						text: submittedText ?? "",
						finishReason: response.result.finishReason,
						iterations: response.result.iterations,
					});
					// Connector replies are emitted only from a successful submit_and_exit call.
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
