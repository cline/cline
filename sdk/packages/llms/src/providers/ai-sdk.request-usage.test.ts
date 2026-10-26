import type {
	AgentModelEvent,
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createOpenAICompatibleProvider } from "./ai-sdk";
import type { AiSdkStreamPart } from "./vendors/types";

const streamTextMock = vi.hoisted(() => vi.fn());

// Replace the external SDK stream result, keeping Cline's real event conversion.
vi.mock("ai", async (importOriginal) => ({
	...(await importOriginal<typeof import("ai")>()),
	streamText: streamTextMock,
}));

async function run(parts: AiSdkStreamPart[]) {
	streamTextMock.mockReturnValue({
		fullStream: (async function* () {
			yield* parts;
		})(),
		usage: Promise.resolve({ inputTokens: 3000, outputTokens: 2 }),
	});
	const config = {
		providerId: "openai-compatible",
		apiKey: "test-key",
		baseUrl: "http://fake.local/v1",
	};
	const model = { id: "test-model", providerId: config.providerId };
	const provider = await createOpenAICompatibleProvider(config);
	const events: AgentModelEvent[] = [];
	for await (const event of await provider.stream(
		{
			providerId: config.providerId,
			modelId: model.id,
			messages: [],
			tools: [],
		} as unknown as GatewayStreamRequest,
		{
			provider: { id: config.providerId, models: [model] },
			model,
			config,
		} as unknown as GatewayProviderContext,
	)) {
		events.push(event);
	}
	return events.find((event) => event.type === "usage");
}

describe("per-request input size", () => {
	it("uses the final internal request rather than total billed inputs", async () => {
		const event = await run([
			{ type: "start-step" },
			{ type: "finish-step", usage: { inputTokens: 1000, outputTokens: 1 } },
			{ type: "start-step" },
			{ type: "text-delta", text: "done" },
			{ type: "finish-step", usage: { inputTokens: 2000, outputTokens: 1 } },
			{ type: "finish", finishReason: "stop" },
		]);

		expect(event).toMatchObject({
			requestInputTokens: 2000,
			usage: { inputTokens: 3000, outputTokens: 2 },
		});
	});

	it.each([
		undefined,
		{},
		{ outputTokens: 1 },
	])("marks the final request size unknown when that step has no input count (%j)", async (usage) => {
		const event = await run([
			{ type: "start-step" },
			{ type: "finish-step", usage: { inputTokens: 1000, outputTokens: 1 } },
			{ type: "start-step" },
			{ type: "text-delta", text: "done" },
			{ type: "finish-step", usage },
			{ type: "finish", finishReason: "stop" },
		]);

		expect(event).toMatchObject({ requestInputTokens: null });
	});

	it("keeps an explicit zero input count separate from an unavailable count", async () => {
		const event = await run([
			{ type: "start-step" },
			{ type: "text-delta", text: "done" },
			{ type: "finish-step", usage: { inputTokens: 0, outputTokens: 1 } },
			{ type: "finish", finishReason: "stop" },
		]);

		expect(event).toMatchObject({ requestInputTokens: 0 });
	});
});
