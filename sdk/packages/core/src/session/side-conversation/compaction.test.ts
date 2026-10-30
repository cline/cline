import type { MessageWithMetadata } from "@cline/llms";
import { SIDE_REFERENCE_KIND } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { runAgenticCompaction } from "../../extensions/context/agentic-compaction";
import { runBasicCompaction } from "../../extensions/context/basic-compaction";
import type { CoreCompactionContext } from "../../types/config";
import { countUserRunMessages } from "../user-run-messages";
import { captureSideReference } from "./context";

vi.mock("@cline/llms", async (original) => ({
	...(await original<typeof import("@cline/llms")>()),
	createHandlerAsync: async () => ({
		createMessage: async function* () {
			yield {
				type: "text",
				text: "## Goal\nAnswer the side question.\n## Progress\nRead the fixture.",
			};
			yield { type: "done", success: true };
		},
	}),
}));

function context(messages: MessageWithMetadata[]): CoreCompactionContext {
	return {
		agentId: "side",
		conversationId: "side",
		parentAgentId: null,
		iteration: 1,
		messages,
		mode: "manual",
		model: {
			id: "test",
			provider: "anthropic",
			info: { id: "test", maxInputTokens: 64000 },
		},
		budget: {
			request: {
				inputTokens: 10000,
				maxInputTokens: 64000,
				triggerTokens: 500,
				targetTokens: 500,
				overheadTokens: 0,
				thresholdRatio: 1,
				utilizationRatio: 2,
			},
			messages: { inputTokens: 10000, triggerTokens: 500, targetTokens: 500 },
		},
	};
}

describe("side reference compaction", () => {
	it.each([
		"basic",
		"agentic",
	] as const)("excludes the parent reference from user-turn counts after %s compaction", async (strategy) => {
		const seed = captureSideReference({
			messages: [
				{ role: "user", content: "parent goal" },
				{ role: "assistant", content: "parent answer" },
			],
			activeParentTurn: false,
		});
		const messages: MessageWithMetadata[] = [
			seed,
			{ role: "user", content: "first actual side question" },
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "read",
						name: "read_files",
						input: { files: ["fixture.txt"] },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "read",
						name: "read_files",
						content: "fixture ".repeat(2000),
					},
				],
			},
			{ role: "assistant", content: "answer" },
			{ role: "user", content: "follow up" },
			{ role: "assistant", content: "follow up answer" },
		];
		const options = {
			context: context(messages),
			estimateMessageTokens: (message: MessageWithMetadata) =>
				JSON.stringify(message).length,
		};
		const result =
			strategy === "basic"
				? runBasicCompaction(options)
				: await runAgenticCompaction({
						...options,
						providerConfig: { providerId: "anthropic", modelId: "test" },
						preserveRecentTokens: 1,
					});
		expect(result?.messages).toBeDefined();
		const compacted = result?.messages ?? [];
		expect(
			compacted.filter(
				(message) =>
					message.metadata?.kind ===
					(strategy === "basic" ? "compaction" : "compaction_summary"),
			),
		).toHaveLength(1);
		expect(
			compacted.some(
				(message) => message.metadata?.kind === SIDE_REFERENCE_KIND,
			),
		).toBe(false);
		expect(countUserRunMessages(compacted)).toBe(2);
	});
});
