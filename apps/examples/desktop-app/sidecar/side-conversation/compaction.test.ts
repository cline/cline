import {
	type CoreCompactionContext,
	countUserRunMessages,
	createSessionCompactionState,
	projectSessionCompactionState,
} from "@cline/core";
import type { MessageWithMetadata } from "@cline/llms";
import { describe, expect, it, vi } from "vitest";
// biome-ignore lint/style/noRestrictedImports: Exercise actual compaction in this desktop integration test without expanding the SDK public API.
import { runAgenticCompaction } from "../../../../../sdk/packages/core/src/extensions/context/agentic-compaction";
// biome-ignore lint/style/noRestrictedImports: Exercise actual compaction in this desktop integration test without expanding the SDK public API.
import { runBasicCompaction } from "../../../../../sdk/packages/core/src/extensions/context/basic-compaction";
import { DESKTOP_SIDE_REFERENCE_KIND } from "../../shared/side-conversation";
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
	] as const)("keeps the %s marker and absolute run numbering through persistence", async (strategy) => {
		const seed = captureSideReference(
			[
				{ role: "user", content: "parent goal" },
				{ role: "assistant", content: "parent answer" },
			],
			false,
		);
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
		// Canonical history retains the reference even when compaction omits it from working context.
		expect(
			compacted.some(
				(message) => message.metadata?.kind === DESKTOP_SIDE_REFERENCE_KIND,
			),
		).toBe(false);
		const state = createSessionCompactionState({
			sourceMessages: messages,
			compactedMessages: compacted,
		});
		const reloaded = JSON.parse(JSON.stringify(messages));
		const projected = projectSessionCompactionState(
			JSON.parse(JSON.stringify(state)),
			reloaded,
		);
		expect(projected).toEqual(compacted);
		expect(countUserRunMessages(projected)).toBe(2);
		expect(reloaded[0]).toEqual(seed);
	});
});
