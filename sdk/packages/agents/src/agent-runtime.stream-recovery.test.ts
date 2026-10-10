import { createGateway } from "@cline/llms";
import type { AgentRuntimeEvent } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "./index";

describe("AgentRuntime with AI SDK stream recovery", () => {
	it.each([
		"content",
		"reasoning_content",
	] as const)("shows interrupted %s attempts but sends only recovered content in the next request", async (field) => {
		const chunk = (
			delta: Record<string, string>,
			finishReason: string | null = null,
		) =>
			`data: ${JSON.stringify({ id: "cmpl-test", object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
		const requests: unknown[] = [];
		let calls = 0;
		const fetch = vi.fn(
			async (
				_input: Parameters<typeof globalThis.fetch>[0],
				init?: RequestInit,
			) => {
				requests.push(JSON.parse(String(init?.body)));
				calls++;
				const body =
					calls <= 2
						? chunk({ role: "assistant", [field]: "The answer is 4" })
						: chunk({
								role: "assistant",
								content: calls === 3 ? "hello" : "Next answer",
							}) +
							chunk({}, "stop") +
							"data: [DONE]\n\n";
				return new Response(body, {
					headers: { "content-type": "text/event-stream" },
				});
			},
		);
		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "openai-compatible",
					apiKey: "test-key",
					baseUrl: "http://fake.local/v1",
					fetch: fetch as typeof globalThis.fetch,
					models: [{ id: "test-model", name: "Test" }],
				},
			],
		});
		const afterModel = vi.fn();
		const runtime = new AgentRuntime({
			model: gateway.createAgentModel({
				providerId: "openai-compatible",
				modelId: "test-model",
			}),
			hooks: { afterModel },
		});
		const events: AgentRuntimeEvent[] = [];
		runtime.subscribe((event) => {
			events.push(event);
		});
		const result = await runtime.run("Hi");
		expect(result.status).toBe("completed");
		expect(result.outputText).toBe("hello");
		expect(result.messages.at(-1)?.content).toEqual([
			{ type: "text", text: "hello" },
		]);
		expect(afterModel.mock.calls[0][0].assistantMessage.content).toEqual([
			{ type: "text", text: "hello" },
		]);
		const displayEvents = events.filter(
			(event) =>
				event.type === "assistant-text-delta" ||
				event.type === "assistant-reasoning-delta" ||
				(event.type === "status-notice" &&
					event.metadata?.kind === "provider_stream_retry"),
		);
		expect(displayEvents.map((event) => event.type)).toEqual([
			field === "content"
				? "assistant-text-delta"
				: "assistant-reasoning-delta",
			"status-notice",
			field === "content"
				? "assistant-text-delta"
				: "assistant-reasoning-delta",
			"status-notice",
			"assistant-text-delta",
		]);
		await runtime.continue("Next question");
		expect(fetch).toHaveBeenCalledTimes(4);
		expect(JSON.stringify(requests[3])).toContain("hello");
		expect(JSON.stringify(requests[3])).not.toContain("The answer is 4");
	});
});
