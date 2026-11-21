import type { AgentMessage, AgentModelEvent } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";

const { withLangfuseTraceAttributesSpy } = vi.hoisted(() => ({
	withLangfuseTraceAttributesSpy: vi.fn(
		async (_enabled: boolean, _attributes: unknown, callback: () => unknown) =>
			await callback(),
	),
}));

vi.mock("../services/langfuse-telemetry", () => ({
	resolveAiSdkTelemetry: async () => ({ isEnabled: true }),
	withLangfuseTraceAttributes: withLangfuseTraceAttributesSpy,
}));

import { createGateway } from "./gateway";

const SID = "session_01TRACEMETADATATEST";

const EMAIL = "trace-metadata@example.com";

const messages: AgentMessage[] = [
	{
		id: "user_1",
		role: "user",
		content: [{ type: "text", text: "hello" }],
		createdAt: Date.now(),
	},
];

function streamResponse(modelId: string): Response {
	const sse = [
		`data: ${JSON.stringify({
			id: "chatcmpl-test",
			created: 0,
			model: modelId,
			choices: [
				{
					index: 0,
					delta: { role: "assistant", content: "ok" },
					finish_reason: null,
				},
			],
		})}`,
		`data: ${JSON.stringify({
			id: "chatcmpl-test",
			created: 0,
			model: modelId,
			choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
		})}`,
		"data: [DONE]",
		"",
	].join("\n\n");
	return new Response(sse, {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

async function collect(
	iterable: AsyncIterable<AgentModelEvent>,
): Promise<AgentModelEvent[]> {
	const events: AgentModelEvent[] = [];
	for await (const event of iterable) {
		events.push(event);
	}
	return events;
}

describe("provider trace metadata", () => {
	it.each([
		"cline",
		"cline-pass",
	])("%s sends the auth sid to Langfuse but no outgoing request", async (providerId) => {
		const modelId = "anthropic/claude-trace-metadata-test";
		const fetchMock = vi.fn(async (_input: URL, _init?: RequestInit) =>
			streamResponse(modelId),
		);
		const gateway = createGateway({
			providerConfigs: [
				{
					providerId,
					apiKey: "not-a-jwt",
					authMetadata: { sid: SID, userInfo: { email: EMAIL } },
					fetch: fetchMock as unknown as typeof fetch,
				},
			],
		});

		const events = await collect(
			await gateway.stream({
				providerId,
				modelId,
				messages,
				metadata: { sessionId: "task-1" },
			}),
		);

		expect(events.at(-1)).toEqual({ type: "finish", reason: "stop" });
		expect(withLangfuseTraceAttributesSpy).toHaveBeenCalledWith(
			true,
			expect.objectContaining({
				metadata: expect.objectContaining({ "auth.sid": SID }),
			}),
			expect.any(Function),
		);
		expect(fetchMock).toHaveBeenCalled();
		for (const [input, init] of fetchMock.mock.calls) {
			const headers = Object.fromEntries(new Headers(init?.headers).entries());
			const sent = JSON.stringify({
				url: String(input),
				headers,
				body: typeof init?.body === "string" ? init.body : "",
			});
			expect(sent).not.toContain(SID);
			expect(sent).not.toContain(EMAIL);
			expect(sent).not.toContain("auth.sid");
		}
	});
});
