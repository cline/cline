// The summary request as an OpenAI-compatible endpoint receives it, through
// the real handler and gateway with a stubbed fetch. The summarizer asks for
// thinking off; the gateway must send `reasoning_effort: "none"` only to a
// model whose catalog entry says it accepts one, since endpoints serving
// models the catalog does not list may reject it and the summary then fails.
import { createHandlerAsync } from "@cline/llms";
import type { ModelReasoningOption } from "@cline/shared";
import { describe, expect, it } from "vitest";
import type { ProviderConfig } from "../../types/provider-settings";
import { resolveSummarizerConfig } from "./compaction-shared";

async function summarizerWireBody(
	session: Omit<ProviderConfig, "providerId" | "modelId" | "fetch">,
	options: { reasoningOptions?: ModelReasoningOption[] } = {},
): Promise<Record<string, unknown>> {
	let body: Record<string, unknown> | undefined;
	const fetchStub = (async (_input, init) => {
		body = JSON.parse((init?.body as string) ?? "{}");
		return new Response(JSON.stringify({ error: { message: "stub" } }), {
			status: 400,
			headers: { "content-type": "application/json" },
		});
	}) as typeof fetch;
	const modelId = "gpt-6-astra";
	const config = resolveSummarizerConfig({
		activeProviderConfig: {
			providerId: "openai-compatible",
			modelId,
			apiKey: "test-key",
			baseUrl: "https://example.test/v1",
			fetch: fetchStub,
			...(options.reasoningOptions
				? {
						modelInfo: {
							id: modelId,
							capabilities: ["reasoning"],
							reasoningOptions: options.reasoningOptions,
						},
					}
				: {}),
			...session,
		},
	});
	const handler = await createHandlerAsync(config);
	for await (const _chunk of handler.createMessage("Summarize.", [
		{ role: "user", content: "Conversation" },
	])) {
		// drain
	}
	if (!body) {
		throw new Error("the stubbed fetch was never called");
	}
	return body;
}

describe("summarizer reasoning on the wire", () => {
	it("sends nothing about reasoning to a model the catalog does not list", async () => {
		const body = await summarizerWireBody({});
		expect(body).not.toHaveProperty("reasoning_effort");
	});

	it("keeps the session's level for a model the catalog does not list", async () => {
		const body = await summarizerWireBody({ reasoningEffort: "high" });
		expect(body.reasoning_effort).toBe("high");
	});

	it("still sends the session's explicit disable", async () => {
		const body = await summarizerWireBody({ thinking: false });
		expect(body.reasoning_effort).toBe("none");
	});

	it("sends none to a model that advertises it", async () => {
		const body = await summarizerWireBody(
			{ reasoningEffort: "high" },
			{
				reasoningOptions: [{ type: "effort", values: ["none", "low", "high"] }],
			},
		);
		expect(body.reasoning_effort).toBe("none");
	});
});
