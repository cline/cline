import type { Message } from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreCompactionContext } from "../../types/config";
import { runAgenticCompaction } from "./agentic-compaction";
import { getCompactionSummaryMetadata } from "./compaction-shared";

const createHandlerMock = vi.fn();

vi.mock("@cline/llms", () => ({
	createHandlerAsync: (config: unknown) => createHandlerMock(config),
}));

async function* streamChunks(
	chunks: Array<Record<string, unknown>>,
): AsyncGenerator<Record<string, unknown>> {
	for (const chunk of chunks) {
		yield chunk;
	}
}

const estimateMessageTokens = (message: Message): number =>
	Math.ceil(JSON.stringify(message).length / 3);

const FAKE_SUMMARY = [
	"## Session Summary",
	"",
	"The user asked to refactor the auth middleware and add rate limiting.",
	"",
	"## Completed",
	"- Rewrote src/middleware/auth.ts to use the new token verifier",
	"- Added src/middleware/rate-limit.ts with a sliding-window limiter",
	"",
	"## Next Steps",
	"- Wire rate-limit middleware into the router",
	"- Add unit tests for the sliding-window edge cases",
].join("\n");

function buildConversation(): MessageWithMetadata[] {
	const filler = "x".repeat(2_000);
	return [
		{ role: "user", content: `Refactor the auth middleware. ${filler}` },
		{
			role: "assistant",
			content: [
				{ type: "text", text: "Reading the middleware first." },
				{
					type: "tool_use",
					id: "tool-1",
					name: "read_file",
					input: { path: "src/middleware/auth.ts" },
				},
			],
		},
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "tool-1",
					name: "read_file",
					content: `export function auth() {} ${filler}`,
				},
			],
		},
		{
			role: "assistant",
			content: [
				{ type: "text", text: "Now applying the edit." },
				{
					type: "tool_use",
					id: "tool-2",
					name: "write_file",
					input: { path: "src/middleware/auth.ts", content: filler },
				},
			],
		},
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "tool-2",
					name: "write_file",
					content: "File written.",
				},
			],
		},
		{ role: "assistant", content: "Done. Anything else?" },
		{ role: "user", content: "Yes, now add rate limiting." },
	];
}

function buildContext(messages: MessageWithMetadata[]): CoreCompactionContext {
	return {
		agentId: "agent-1",
		conversationId: "conv-1",
		parentAgentId: null,
		iteration: 3,
		messages,
		model: { id: "claude-sonnet-5", provider: "anthropic" },
		maxInputTokens: 200_000,
		triggerTokens: 160_000,
		thresholdRatio: 0.8,
		utilizationRatio: 0.85,
	};
}

describe("runAgenticCompaction (observable output)", () => {
	beforeEach(() => {
		createHandlerMock.mockReset();
	});

	it("compacts the conversation and prints the resulting summary message", async () => {
		let capturedSummaryRequest = "";
		createHandlerMock.mockResolvedValue({
			createMessage: (_systemPrompt: string, requestMessages: Message[]) => {
				capturedSummaryRequest = String(requestMessages[0]?.content ?? "");
				return streamChunks([
					{ type: "text", text: FAKE_SUMMARY },
					{ type: "done", success: true },
				]);
			},
		});

		const messages = buildConversation();
		const result = await runAgenticCompaction({
			context: buildContext(messages),
			providerConfig: {
				providerId: "anthropic",
				modelId: "claude-sonnet-5",
				maxInputTokens: 200_000,
			} as never,
			preserveRecentTokens: 10,
			estimateMessageTokens,
			logger: {
				log: (message: string, data?: Record<string, unknown>) =>
					console.log(`[log] ${message}`, data ?? ""),
				debug: (message: string, data?: Record<string, unknown>) =>
					console.log(`[debug] ${message}`, data ?? ""),
			} as never,
		});

		expect(result).toBeDefined();
		if (!result) {
			throw new Error("expected a compaction result");
		}
		const summaryMessage = result.messages[0];
		const metadata = getCompactionSummaryMetadata(summaryMessage);
		expect(metadata?.summary).toContain("Session Summary");
		expect(result.messages.length).toBeLessThan(messages.length);
		expect(result.budget?.policyIntent).toBe("agentic_summary");

		console.log("\n===== SUMMARY REQUEST SENT TO SUMMARIZER =====\n");
		console.log(capturedSummaryRequest);
		console.log("\n===== COMPACTED FIRST MESSAGE (summary) =====\n");
		console.log(summaryMessage.content);
		console.log("\n===== SUMMARY METADATA =====\n");
		console.log(JSON.stringify(metadata, null, 2));
		console.log("\n===== RESULTING CONVERSATION SHAPE =====\n");
		console.log(
			result.messages.map((message, index) => ({
				index,
				role: message.role,
				kind: getCompactionSummaryMetadata(message)?.kind ?? "regular",
				chars: JSON.stringify(message.content).length,
			})),
		);
		console.log("\n===== BUDGET =====\n");
		console.log(result.budget);
	});
});
