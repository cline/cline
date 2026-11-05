// Wire-contract tests for interleaved reasoning history on OpenAI-compatible
// providers, through the real `@ai-sdk/openai-compatible` adapter. Models whose
// catalog fact says `interleavedReasoningField: "reasoning_content"` (Beam,
// DeepSeek thinking mode, ...) reject assistant history without a non-empty
// `reasoning_content`, so history that lost its reasoning gets a placeholder.
import type { AgentMessage, GatewayModelDefinition } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createGateway } from "../gateway";

const history = (assistant: AgentMessage["content"]): AgentMessage[] => [
	{
		id: "u1",
		role: "user",
		content: [{ type: "text", text: "hi" }],
		createdAt: 0,
	},
	{ id: "a1", role: "assistant", content: assistant, createdAt: 0 },
	{
		id: "u2",
		role: "user",
		content: [{ type: "text", text: "again" }],
		createdAt: 0,
	},
];

async function assistantWire(input: {
	providerId: string;
	modelId: string;
	assistant: AgentMessage["content"];
	metadata?: GatewayModelDefinition["metadata"];
}): Promise<Record<string, unknown>> {
	let body: { messages: Record<string, unknown>[] } | undefined;
	const fetchStub = (async (_input, init) => {
		body = JSON.parse((init?.body as string) ?? "{}");
		return new Response(JSON.stringify({ error: { message: "stub" } }), {
			status: 400,
			headers: { "content-type": "application/json" },
		});
	}) as typeof fetch;
	const gateway = createGateway({
		providerConfigs: [
			{
				providerId: input.providerId,
				apiKey: "test-key",
				fetch: fetchStub,
				...(input.metadata
					? {
							models: [
								{
									id: input.modelId,
									name: input.modelId,
									capabilities: ["text", "reasoning"],
									metadata: input.metadata,
								},
							],
						}
					: {}),
			},
		],
	});
	for await (const _event of await gateway.stream({
		providerId: input.providerId,
		modelId: input.modelId,
		maxTokens: 16,
		messages: history(input.assistant),
	})) {
		// drain
	}
	const assistant = body?.messages.find((m) => m.role === "assistant");
	if (!assistant) throw new Error("no assistant message reached the wire");
	return assistant;
}

const text = [{ type: "text" as const, text: "hello" }];

describe("interleaved reasoning history", () => {
	it("fills a placeholder when the model needs reasoning_content", async () => {
		const assistant = await assistantWire({
			providerId: "nvidia",
			modelId: "needs-reasoning",
			assistant: text,
			metadata: { interleavedReasoningField: "reasoning_content" },
		});
		expect(assistant.reasoning_content).toBe(" ");
	});

	it("keeps real reasoning as is", async () => {
		const assistant = await assistantWire({
			providerId: "nvidia",
			modelId: "needs-reasoning",
			assistant: [{ type: "reasoning", text: "thought" }, ...text],
			metadata: { interleavedReasoningField: "reasoning_content" },
		});
		expect(assistant.reasoning_content).toBe("thought");
	});

	it("leaves models without the fact unchanged", async () => {
		const assistant = await assistantWire({
			providerId: "nvidia",
			modelId: "plain-model",
			assistant: text,
			metadata: { family: "plain" },
		});
		expect(assistant).not.toHaveProperty("reasoning_content");
	});

	it.each([
		"reflection/beam-free",
		"reflection/beam-1.0-501b-a23b",
	])("fills for %s on the built-in Cline provider", async (modelId) => {
		const assistant = await assistantWire({
			providerId: "cline",
			modelId,
			assistant: text,
		});
		expect(assistant.reasoning_content).toBe(" ");
	});
});
