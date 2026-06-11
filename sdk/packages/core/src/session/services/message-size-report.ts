/**
 * Request-size verification harness.
 *
 * Measures how much of a conversation transcript actually reaches the
 * provider after `MessageBuilder.buildForApi()`, including the structured
 * `ToolOperationResult[]` payloads that JSON-serialize into the request.
 * Used by the debug script `scripts/report-request-size.ts` and by tests to
 * compare current vs patched truncation behavior.
 */

import {
	type AiSdkFormatterMessage,
	formatMessagesForAiSdk,
	type Message,
} from "@cline/shared";
import { messagesToAgentMessages } from "../../runtime/config/agent-message-codec";
import { MessageBuilder } from "./message-builder";

export interface MessageSizeReport {
	/** JSON-serialized size of the raw transcript, in bytes. */
	rawTranscriptBytes: number;
	/** JSON-serialized size of the transcript after buildForApi(). */
	builtTranscriptBytes: number;
	/** JSON-serialized size of the provider-formatted (AI SDK) payload built from the raw transcript. */
	rawProviderPayloadBytes: number;
	/** JSON-serialized size of the provider-formatted (AI SDK) payload after buildForApi(). */
	builtProviderPayloadBytes: number;
	/** Largest single string nested anywhere in a tool_result before buildForApi(), in bytes. */
	largestToolResultStringBeforeBytes: number;
	/** Largest single string nested anywhere in a tool_result after buildForApi(), in bytes. */
	largestToolResultStringAfterBytes: number;
	/** Percent reduction of the provider-formatted payload (0-100). */
	providerPayloadPercentReduction: number;
}

export function buildMessageSizeReport(
	messages: Message[],
	builder: MessageBuilder = new MessageBuilder(),
): MessageSizeReport {
	const built = builder.buildForApi(messages);

	const rawTranscriptBytes = utf8ByteLength(JSON.stringify(messages));
	const builtTranscriptBytes = utf8ByteLength(JSON.stringify(built));
	const rawProviderPayloadBytes = providerPayloadBytes(messages);
	const builtProviderPayloadBytes = providerPayloadBytes(built);

	return {
		rawTranscriptBytes,
		builtTranscriptBytes,
		rawProviderPayloadBytes,
		builtProviderPayloadBytes,
		largestToolResultStringBeforeBytes: largestToolResultStringBytes(messages),
		largestToolResultStringAfterBytes: largestToolResultStringBytes(built),
		providerPayloadPercentReduction:
			rawProviderPayloadBytes === 0
				? 0
				: ((rawProviderPayloadBytes - builtProviderPayloadBytes) /
						rawProviderPayloadBytes) *
					100,
	};
}

export function formatMessageSizeReport(report: MessageSizeReport): string {
	const lines = [
		`raw transcript serialized size:      ${formatBytes(report.rawTranscriptBytes)}`,
		`post-buildForApi serialized size:    ${formatBytes(report.builtTranscriptBytes)}`,
		`raw provider payload size:           ${formatBytes(report.rawProviderPayloadBytes)}`,
		`post-buildForApi provider payload:   ${formatBytes(report.builtProviderPayloadBytes)}`,
		`largest nested tool-result string:   ${formatBytes(report.largestToolResultStringBeforeBytes)} -> ${formatBytes(report.largestToolResultStringAfterBytes)}`,
		`estimated provider payload reduction: ${report.providerPayloadPercentReduction.toFixed(1)}%`,
	];
	return lines.join("\n");
}

/**
 * Serializes messages the same way the AI SDK provider boundary does
 * (`toAiSdkMessages` in @cline/llms): codec to agent messages, then
 * `formatMessagesForAiSdk`. This is the size that actually goes on the wire.
 */
function providerPayloadBytes(messages: Message[]): number {
	const agentMessages = messagesToAgentMessages(messages);
	const formatted = formatMessagesForAiSdk(
		undefined,
		agentMessages.map(({ role, content }) => ({
			role,
			content,
		})) as unknown as AiSdkFormatterMessage[],
	);
	return utf8ByteLength(JSON.stringify(formatted));
}

function largestToolResultStringBytes(messages: Message[]): number {
	let largest = 0;
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type !== "tool_result") {
				continue;
			}
			largest = Math.max(largest, largestNestedStringBytes(block.content));
		}
	}
	return largest;
}

function largestNestedStringBytes(value: unknown): number {
	if (typeof value === "string") {
		return utf8ByteLength(value);
	}
	if (Array.isArray(value)) {
		let largest = 0;
		for (const item of value) {
			largest = Math.max(largest, largestNestedStringBytes(item));
		}
		return largest;
	}
	if (value !== null && typeof value === "object") {
		let largest = 0;
		for (const item of Object.values(value)) {
			largest = Math.max(largest, largestNestedStringBytes(item));
		}
		return largest;
	}
	return 0;
}

function formatBytes(bytes: number): string {
	if (bytes >= 1_000_000) {
		return `${(bytes / 1_000_000).toFixed(2)} MB (${bytes} bytes)`;
	}
	if (bytes >= 1_000) {
		return `${(bytes / 1_000).toFixed(1)} kB (${bytes} bytes)`;
	}
	return `${bytes} bytes`;
}

function utf8ByteLength(text: string): number {
	return Buffer.byteLength(text, "utf8");
}
