import { createGateway } from "@cline/llms";
import type {
	AgentModel,
	AgentModelEvent,
	ITelemetryService,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "./agent-runtime";

beforeEach(() => {
	// This wire test replaces HTTP, never the tracing exporter.
	vi.stubEnv("LANGFUSE_BASE_URL", "");
	vi.stubEnv("LANGFUSE_PUBLIC_KEY", "");
	vi.stubEnv("LANGFUSE_SECRET_KEY", "");
});
afterEach(() => vi.unstubAllEnvs());

// Keep the gateway, Cline provider, AI SDK and agent real. Only HTTP is replaced.
describe("timeouts after a completed Cline model-tool step", () => {
	it.each([
		"agent",
		"standalone",
	] as const)("preserves the timeout at the %s boundary", async (owner) => {
		const capture = vi.fn();
		const telemetry = { capture } as unknown as ITelemetryService;
		const controller = new AbortController();
		let modelCalls = 0;
		let searches = 0;
		let timeoutReason: unknown;
		const encoder = new TextEncoder();
		const sse = (value: unknown) =>
			encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
		const fetchStub = (async (input, init) => {
			if (String(input).endsWith("/search/websearch")) {
				searches++;
				return Response.json({ data: { results: [] } });
			}
			modelCalls++;
			if (modelCalls === 1) {
				return new Response(
					new ReadableStream({
						start(stream) {
							stream.enqueue(
								sse({
									id: "first-step",
									choices: [
										{
											index: 0,
											delta: {
												tool_calls: [
													{
														index: 0,
														id: "search-1",
														type: "function",
														function: {
															name: "web_search",
															arguments: '{"query":"test"}',
														},
													},
												],
											},
											finish_reason: "tool_calls",
										},
									],
									usage: {
										prompt_tokens: 1,
										completion_tokens: 1,
										total_tokens: 2,
									},
								}),
							);
							stream.enqueue(encoder.encode("data: [DONE]\n\n"));
							stream.close();
						},
					}),
					{ headers: { "content-type": "text/event-stream" } },
				);
			}
			if (modelCalls > 2)
				throw new Error("Timeout must not restart the completed tool step");
			const signal = init?.signal;
			return new Response(
				new ReadableStream({
					start(stream) {
						stream.enqueue(
							sse({
								id: "second-step",
								choices: [
									{
										index: 0,
										delta: { content: "partial answer" },
										finish_reason: null,
									},
								],
							}),
						);
						signal?.addEventListener(
							"abort",
							() =>
								stream.error(new DOMException("Reader aborted", "AbortError")),
							{ once: true },
						);
						const timeout = AbortSignal.timeout(5);
						timeout.addEventListener(
							"abort",
							() => {
								timeoutReason = timeout.reason;
								controller.abort(timeout.reason);
							},
							{ once: true },
						);
					},
				}),
				{ headers: { "content-type": "text/event-stream" } },
			);
		}) as typeof fetch;
		const gateway = createGateway({
			telemetry,
			providerConfigs: [
				{
					providerId: "cline",
					apiKey: "test",
					baseUrl: "https://test.invalid",
					fetch: fetchStub,
				},
			],
		});
		const events: AgentModelEvent[] = [];
		if (owner === "agent") {
			const gatewayModel = gateway.createAgentModel(
				{ providerId: "cline", modelId: "test-model" },
				{ modelTools: [{ name: "web_search" }] },
			);
			const model: AgentModel = {
				async *stream(request) {
					const signal = request.signal
						? AbortSignal.any([request.signal, controller.signal])
						: controller.signal;
					for await (const event of await gatewayModel.stream({
						...request,
						signal,
					})) {
						events.push(event);
						yield event;
					}
				},
			};
			const result = await new AgentRuntime({
				model,
				telemetry,
				sessionId: "timeout-session",
			}).run("Search for test");
			expect(result.status).toBe("failed");
			expect(result.error?.cause).toBe(timeoutReason);
			expect(result.error?.message).toBe(
				(timeoutReason as DOMException).message,
			);
		} else {
			for await (const event of await gateway.stream({
				providerId: "cline",
				modelId: "test-model",
				messages: [{ role: "user", content: "Search for test" }],
				modelTools: [{ name: "web_search" }],
				signal: controller.signal,
			}))
				events.push(event);
		}
		expect(modelCalls).toBe(2);
		expect(searches).toBe(1);
		expect(events.at(-1)).toMatchObject({
			type: "finish",
			reason: "error",
			failure: { cause: timeoutReason, context: { errorPhase: "timeout" } },
		});
		const errors = capture.mock.calls
			.map(([event]) => event)
			.filter((event) => event.event === "sdk.error");
		expect(errors).toHaveLength(1);
		expect(errors[0].properties).toMatchObject({
			component: owner === "agent" ? "agents" : "llms",
			operation: owner === "agent" ? "agent.run" : "provider.stream",
			error_type: "TimeoutError",
			errorPhase: "timeout",
		});
	});
});
