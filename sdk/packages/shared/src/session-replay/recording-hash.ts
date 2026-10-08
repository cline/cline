import { createHash } from "node:crypto";
import type { AgentModelRequest } from "../agent";
import { SESSION_RECORDING_MATCH_KEY_VERSION } from "./recording-schema";

function sha256Hex(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

/** sha256 of a message's `[role, content]`: what the provider sees of it. */
export function recordedMessageContentSha256(message: {
	role: string;
	content: unknown;
}): string {
	return sha256Hex(JSON.stringify([message.role, message.content]));
}

/**
 * The key phase-3 replay pairs a live request with a recorded one by. Built
 * from content hashes only, so message ids, timestamps and metadata (all of
 * which differ between runs) do not affect it.
 */
export function computeRecordedRequestMatchKey(input: {
	systemPromptSha256: string | null;
	toolsSha256: string;
	messageContentSha256s: readonly string[];
}): string {
	return sha256Hex(
		[
			SESSION_RECORDING_MATCH_KEY_VERSION,
			input.systemPromptSha256 ?? "",
			input.toolsSha256,
			...input.messageContentSha256s,
		].join("\n"),
	);
}

export function recordedToolDefinitions(
	tools: AgentModelRequest["tools"],
): Array<{ name: string; description: string; inputSchema: unknown }> {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema,
	}));
}
