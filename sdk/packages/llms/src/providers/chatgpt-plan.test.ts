import type { AgentModelEvent } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	assertChatGPTPlanGrant,
	CHATGPT_PLAN_API,
	chatGPTPlanFetch,
	fetchChatGPTPlanModels,
} from "./chatgpt-plan";
import { createGateway } from "./gateway";

const grant = {
	clientId: "oaiapp_test",
	subject: "subject",
	issuer: "https://auth.openai.com",
	scopes: ["chatgpt.tokens.use.direct"],
};
const completed = 'data: {"type":"response.completed"}\n\n';

describe("ChatGPT plan transport", () => {
	it.each([
		undefined,
		{},
		{ ...grant, scopes: [] },
		{ ...grant, clientId: "dynamic_agent_client" },
	])("rejects missing plan permission", (input) => {
		expect(() => assertChatGPTPlanGrant(input)).toThrow(
			"grant ChatGPT plan usage",
		);
	});
	it("uses only the account's visible model catalog in server order", async () => {
		const fetch = vi.fn(async () =>
			Response.json({
				models: [
					{ slug: "z", display_name: "Z model", visibility: "list" },
					{ slug: "hidden", display_name: "Hidden", visibility: "hidden" },
					{ slug: "a", display_name: "A model", visibility: "list" },
				],
			}),
		);
		const models = await fetchChatGPTPlanModels({
			providerId: "openai-chatgpt",
			modelId: "",
			apiKey: "token",
			chatgptPlan: grant,
			fetch: fetch as typeof globalThis.fetch,
		});
		expect(Object.keys(models)).toEqual(["z", "a"]);
		expect(fetch).toHaveBeenCalledWith(
			`${CHATGPT_PLAN_API}/models`,
			expect.objectContaining({
				headers: { Authorization: "Bearer token" },
				redirect: "error",
			}),
		);
	});
	it("sends a stateless streaming Responses request and drops unsupported fields", async () => {
		const delegate = vi.fn(async () => new Response(completed));
		const fetch = chatGPTPlanFetch(
			delegate as typeof globalThis.fetch,
			"plan-token",
		);
		const response = await fetch(`${CHATGPT_PLAN_API}/responses`, {
			method: "POST",
			headers: { Authorization: "Bearer other-token" },
			body: JSON.stringify({
				model: "example",
				input: [{ type: "message", role: "system", content: "instructions" }],
				store: true,
				stream: false,
				temperature: 1,
				max_output_tokens: 100,
				previous_response_id: "old",
				metadata: { private: "value" },
			}),
		});
		expect(await response.text()).toBe(completed);
		const init = (
			delegate.mock.calls[0] as unknown as [string, RequestInit]
		)[1];
		expect(JSON.parse(init.body as string)).toEqual({
			model: "example",
			input: [{ type: "message", role: "developer", content: "instructions" }],
			store: false,
			stream: true,
		});
		expect(init.headers).toEqual({
			"Content-Type": "application/json",
			Authorization: "Bearer plan-token",
		});
		expect(init.redirect).toBe("error");
	});
	it.each([
		"https://chatgpt.com/backend-api/codex/responses",
		"https://attacker.example/v1/responses",
		`${CHATGPT_PLAN_API}/chat/completions`,
	])("does not send a token to %s", async (url) => {
		const delegate = vi.fn();
		await expect(
			chatGPTPlanFetch(delegate as typeof fetch, "token")(url, {
				method: "POST",
				body: "{}",
			}),
		).rejects.toThrow("only the public");
		expect(delegate).not.toHaveBeenCalled();
	});
	it.each([
		'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
		'data: {"type":"response.incomplete"}\n\n',
		'data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n',
	])("rejects incomplete, interrupted, and quota-failed streams", async (body) => {
		const fetch = chatGPTPlanFetch(
			(async () => new Response(body)) as typeof globalThis.fetch,
			"token",
		);
		const response = await fetch(`${CHATGPT_PLAN_API}/responses`, {
			method: "POST",
			body: '{"input":[]}',
		});
		await expect(response.text()).rejects.toThrow();
	});
});

it("integrates plan authorization and stateless streaming with the real gateway and OpenAI SDK", async () => {
	const events = [
		{
			type: "response.created",
			response: { id: "resp-1", created_at: 1, model: "test" },
		},
		{
			type: "response.output_item.added",
			output_index: 0,
			item: { type: "message", id: "msg-1", role: "assistant", content: [] },
		},
		{
			type: "response.output_text.delta",
			item_id: "msg-1",
			output_index: 0,
			content_index: 0,
			delta: "OK",
		},
		{
			type: "response.output_item.done",
			output_index: 0,
			item: {
				type: "message",
				id: "msg-1",
				role: "assistant",
				content: [{ type: "output_text", text: "OK", annotations: [] }],
			},
		},
		{
			type: "response.completed",
			response: {
				id: "resp-1",
				created_at: 1,
				model: "test",
				status: "completed",
				incomplete_details: null,
				usage: {
					input_tokens: 10,
					output_tokens: 1,
					input_tokens_details: { cached_tokens: 0 },
					output_tokens_details: { reasoning_tokens: 0 },
				},
			},
		},
	];
	const fetchMock = vi.fn(
		async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
			new Response(
				events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
				{ headers: { "content-type": "text/event-stream" } },
			),
	);
	const gateway = createGateway({
		providerConfigs: [
			{
				providerId: "openai-chatgpt",
				apiKey: "plan-token",
				options: { chatgptPlan: grant },
				fetch: fetchMock as typeof fetch,
			},
		],
	});
	const output: AgentModelEvent[] = [];
	for await (const event of await gateway.stream({
		providerId: "openai-chatgpt",
		modelId: "test",
		systemPrompt: "Be concise",
		messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
	}))
		output.push(event);
	expect(output).toContainEqual(
		expect.objectContaining({ type: "text-delta", text: "OK" }),
	);
	expect(fetchMock).toHaveBeenCalledTimes(1);
	const [url, init] = fetchMock.mock.calls[0]!;
	expect(url).toBe(`${CHATGPT_PLAN_API}/responses`);
	const body = JSON.parse(String(init?.body));
	expect(body).toMatchObject({
		store: false,
		stream: true,
		instructions: "Be concise",
		input: [{ role: "user", content: [{ type: "input_text", text: "Hello" }] }],
	});
	expect(body).not.toHaveProperty("max_output_tokens");
	expect(new Headers(init?.headers).get("Authorization")).toBe(
		"Bearer plan-token",
	);
});

it("blocks an ungranted token before the gateway can make any HTTP call", async () => {
	const fetchMock = vi.fn();
	const gateway = createGateway({
		providerConfigs: [
			{
				providerId: "openai-chatgpt",
				apiKey: "ungranted",
				fetch: fetchMock as typeof fetch,
			},
		],
	});
	const output: AgentModelEvent[] = [];
	for await (const event of await gateway.stream({
		providerId: "openai-chatgpt",
		modelId: "test",
		messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
	}))
		output.push(event);
	expect(output).toContainEqual(
		expect.objectContaining({
			type: "finish",
			reason: "error",
			error: expect.stringContaining("grant ChatGPT plan usage"),
		}),
	);
	expect(fetchMock).not.toHaveBeenCalled();
});
