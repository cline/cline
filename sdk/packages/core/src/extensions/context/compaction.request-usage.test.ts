import { AgentRuntime } from "@cline/agents";
import type { AgentModel, AgentModelEvent } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { agentMessagesToMessagesWithMetadata } from "../../runtime/config/agent-message-codec";
import type { CoreCompactionContext } from "../../types/config";
import { createContextCompactionPrepareTurn } from "./compaction";

describe("compaction request usage", () => {
	it.each([
		{
			name: "single request",
			inputTokens: 1000,
			requestInputTokens: 1000,
			previousInputTokens: 1000,
			shouldCompact: false,
		},
		{
			name: "hidden retries of the same prompt",
			inputTokens: 2000,
			requestInputTokens: 1000,
			previousInputTokens: 1000,
			shouldCompact: false,
		},
		{
			name: "a larger final request in an internal multi-step call",
			inputTokens: 3000,
			requestInputTokens: 2000,
			previousInputTokens: 2000,
			shouldCompact: true,
		},
		{
			name: "an older provider below the context limit",
			inputTokens: 1000,
			previousInputTokens: 1000,
			shouldCompact: false,
		},
		{
			name: "an older provider above the context limit",
			inputTokens: 2000,
			previousInputTokens: 2000,
			shouldCompact: true,
		},
		...[
			{ name: "explicitly unknown", requestInputTokens: null },
			{ name: "zero", requestInputTokens: 0 },
			{ name: "negative", requestInputTokens: -1 },
			{ name: "non-finite", requestInputTokens: Number.POSITIVE_INFINITY },
			{ name: "NaN", requestInputTokens: Number.NaN },
		].map((scenario) => ({
			...scenario,
			inputTokens: 2000,
			previousInputTokens: undefined,
			shouldCompact: false,
		})),
	])("uses actual prompt size for $name", async (scenario) => {
		const compactions: CoreCompactionContext[] = [];
		const previousInputs: Array<number | undefined> = [];
		const prepare = createContextCompactionPrepareTurn({
			providerId: "openai-compatible",
			modelId: "test-model",
			compaction: {
				enabled: true,
				compact: async (context) => {
					compactions.push(context);
					return undefined;
				},
			},
		});
		let requests = 0;
		const model: AgentModel = {
			async *stream(): AsyncIterable<AgentModelEvent> {
				if (requests++ === 0) {
					// An explicit unknown/invalid value must also clear a prior size.
					yield {
						type: "usage",
						usage: {},
						requestInputTokens: 2000,
					};
					yield {
						type: "tool-call-delta",
						toolCallId: "echo-1",
						toolName: "echo",
						input: {},
					};
					yield {
						type: "usage",
						usage: { inputTokens: scenario.inputTokens, outputTokens: 1 },
						...("requestInputTokens" in scenario
							? { requestInputTokens: scenario.requestInputTokens }
							: {}),
					};
					yield { type: "finish", reason: "tool-calls" };
				} else {
					yield { type: "text-delta", text: "done" };
					yield { type: "finish", reason: "stop" };
				}
			},
		};
		const runtime = new AgentRuntime({
			model,
			systemPrompt: "You are helpful.",
			tools: [
				{
					name: "echo",
					description: "Echo",
					inputSchema: { type: "object" },
					execute: async () => ({ ok: true }),
				},
			],
			prepareTurn: async (context) => {
				previousInputs.push(context.previousRequestInputTokens);
				const messages = agentMessagesToMessagesWithMetadata(context.messages);
				await prepare?.({
					agentId: context.agentId,
					conversationId: "test-conversation",
					parentAgentId: null,
					iteration: context.iteration,
					messages,
					apiMessages: messages,
					abortSignal: context.signal ?? new AbortController().signal,
					systemPrompt: context.systemPrompt ?? "",
					tools: [...context.tools],
					previousRequestInputTokens: context.previousRequestInputTokens,
					model: {
						id: "test-model",
						provider: "openai-compatible",
						info: { id: "test-model", maxInputTokens: 1800 },
					},
				});
				return undefined;
			},
		});

		const result = await runtime.run("x".repeat(3000));

		expect(result.status).toBe("completed");
		expect(result.outputText).toBe("done");
		expect(result.usage.inputTokens).toBe(scenario.inputTokens);
		expect(compactions).toHaveLength(scenario.shouldCompact ? 1 : 0);
		expect(previousInputs).toEqual([undefined, scenario.previousInputTokens]);
	});
});
