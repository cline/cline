import type {
	AgentConfig,
	AgentModelEvent,
	AgentModelRequest,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	FORK_THINKING_ALLOWANCE_TOKENS,
	ModelAnswerError,
} from "./ephemeral-fork";
import {
	FRESH_REQUEST_RETRY_REASONING_EFFORT,
	FRESH_REQUEST_TEMPERATURE,
	sendFreshRequest,
} from "./fresh-request";

type Reply = AgentModelEvent[] | Error;

/** A model factory that records the config and request of each call and replies from a script. */
function scriptedModels(replies: Reply[]) {
	const configs: AgentConfig[] = [];
	const requests: AgentModelRequest[] = [];
	const createModel = (config: AgentConfig) => {
		configs.push(config);
		return {
			stream: async (request: AgentModelRequest) => {
				requests.push(request);
				const reply = replies.shift();
				if (!reply) throw new Error("no scripted reply");
				if (reply instanceof Error) throw reply;
				return (async function* (): AsyncIterable<AgentModelEvent> {
					yield* reply;
				})();
			},
		};
	};
	return { configs, requests, createModel };
}

const answer = (text: string): AgentModelEvent[] => [
	{ type: "text-delta", text },
	{ type: "usage", usage: { inputTokens: 40, outputTokens: 8 } },
	{ type: "finish", reason: "stop" },
];

const refusal: AgentModelEvent[] = [
	{
		type: "finish",
		reason: "error",
		error: "400 reasoning cannot be disabled for this model",
		errorClass: "unknown",
		errorRetryable: false,
	},
];

function chatConfig(modelId: string): AgentConfig {
	return {
		providerId: "anthropic",
		modelId,
		apiKey: "test-key",
		systemPrompt: "The chat's own system prompt.",
		tools: [],
		thinking: true,
		thinkingBudgetTokens: 8_000,
		reasoningEffort: "high",
		maxTokensPerTurn: 32_000,
		temperature: 1,
	};
}

const request = (signal = new AbortController().signal) => ({
	system: "You plan.",
	prompt: "Plan it.",
	maxOutputTokens: 400,
	signal,
});

describe("sendFreshRequest", () => {
	it("sends only the system prompt and the question, tool-less, with reasoning off", async () => {
		const models = scriptedModels([answer("Plan the work")]);

		const result = await sendFreshRequest(chatConfig("model-a"), request(), {
			createModel: models.createModel,
		});

		expect(result).toMatchObject({
			text: "Plan the work",
			usage: { inputTokens: 40, outputTokens: 8 },
			calledTools: [],
		});
		expect(models.configs).toHaveLength(1);
		expect(models.configs[0]).toMatchObject({
			providerId: "anthropic",
			modelId: "model-a",
			apiKey: "test-key",
			thinking: false,
			reasoningEffort: undefined,
			thinkingBudgetTokens: undefined,
			maxTokensPerTurn: 400,
			temperature: FRESH_REQUEST_TEMPERATURE,
		});
		expect(models.requests[0]).toMatchObject({
			systemPrompt: "You plan.",
			tools: [],
			messages: [
				{ role: "user", content: [{ type: "text", text: "Plan it." }] },
			],
		});
		const { metadata: _metadata, ...options } =
			models.requests[0]?.options ?? {};
		expect(options).toEqual({
			thinking: false,
			maxTokensPerTurn: 400,
			temperature: FRESH_REQUEST_TEMPERATURE,
		});
	});

	it("asks a model that refuses reasoning off again with low reasoning and room for it, then skips the first try", async () => {
		const models = scriptedModels([refusal, answer("Second"), answer("Third")]);
		const deps = { createModel: models.createModel };

		const second = await sendFreshRequest(
			chatConfig("model-b"),
			request(),
			deps,
		);
		const third = await sendFreshRequest(
			chatConfig("model-b"),
			request(),
			deps,
		);

		expect(second.text).toBe("Second");
		expect(third.text).toBe("Third");
		expect(models.configs.map((config) => config.thinking)).toEqual([
			false,
			true,
			true,
		]);
		expect(models.configs[1]).toMatchObject({
			reasoningEffort: FRESH_REQUEST_RETRY_REASONING_EFFORT,
			thinkingBudgetTokens: undefined,
			maxTokensPerTurn: 400 + FORK_THINKING_ALLOWANCE_TOKENS,
		});
		expect(models.requests[1]?.options).toMatchObject({
			thinking: true,
			reasoningEffort: FRESH_REQUEST_RETRY_REASONING_EFFORT,
		});
		expect(models.requests[1]?.options).not.toHaveProperty(
			"thinkingBudgetTokens",
		);
	});

	it.each([
		[
			"an auth failure",
			[
				{
					type: "finish",
					reason: "error",
					error: "401 unauthorized",
					errorClass: "auth",
				},
			] satisfies AgentModelEvent[],
		],
		[
			"a transient failure",
			[
				{
					type: "finish",
					reason: "error",
					error: "529 overloaded",
					errorRetryable: true,
				},
			] satisfies AgentModelEvent[],
		],
	])("does not retry %s", async (_name, failure) => {
		const models = scriptedModels([failure, answer("unreachable")]);

		await expect(
			sendFreshRequest(chatConfig("model-c"), request(), {
				createModel: models.createModel,
			}),
		).rejects.toBeInstanceOf(ModelAnswerError);
		expect(models.configs).toHaveLength(1);
	});

	it("does not retry a request its caller aborted", async () => {
		const caller = new AbortController();
		const models = scriptedModels([
			new Error("aborted"),
			answer("unreachable"),
		]);
		caller.abort();

		await expect(
			sendFreshRequest(chatConfig("model-d"), request(caller.signal), {
				createModel: models.createModel,
			}),
		).rejects.toThrow("aborted");
		expect(models.configs).toHaveLength(1);
	});
});
