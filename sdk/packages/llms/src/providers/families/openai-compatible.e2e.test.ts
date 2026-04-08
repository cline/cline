import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { OpenAICompatibleHandler } from "./openai-compatible";

type CapturedRequest = {
	method?: string;
	url?: string;
	headers: Record<string, string | string[] | undefined>;
	body: Record<string, unknown>;
};

function createSseChunk(payload: Record<string, unknown>): string {
	return `data: ${JSON.stringify(payload)}\n\n`;
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
	const chunks: T[] = [];
	for await (const chunk of stream) {
		chunks.push(chunk);
	}
	return chunks;
}

async function startFakeOpenAICompatibleServer() {
	const requests: CapturedRequest[] = [];
	const server = createServer(async (req, res) => {
		const body = await new Promise<string>((resolve, reject) => {
			let data = "";
			req.setEncoding("utf8");
			req.on("data", (chunk) => {
				data += chunk;
			});
			req.on("end", () => resolve(data));
			req.on("error", reject);
		});

		requests.push({
			method: req.method,
			url: req.url,
			headers: req.headers,
			body: JSON.parse(body) as Record<string, unknown>,
		});

		res.writeHead(200, {
			"content-type": "text/event-stream",
			connection: "keep-alive",
			"cache-control": "no-cache",
		});
		res.write(
			createSseChunk({
				id: "chatcmpl-test",
				created: 1,
				model: "test-model",
				choices: [
					{
						delta: {
							role: "assistant",
							content: "OK",
						},
						finish_reason: null,
					},
				],
			}),
		);
		res.write(
			createSseChunk({
				id: "chatcmpl-test",
				created: 1,
				model: "test-model",
				choices: [
					{
						delta: {},
						finish_reason: "stop",
					},
				],
				usage: {
					prompt_tokens: 10,
					completion_tokens: 1,
					total_tokens: 11,
				},
			}),
		);
		res.write("data: [DONE]\n\n");
		res.end();
	});

	await new Promise<void>((resolve, reject) => {
		server.listen(0, "127.0.0.1", () => resolve());
		server.on("error", reject);
	});

	const address = server.address() as AddressInfo;
	return {
		requests,
		baseUrl: `http://127.0.0.1:${address.port}`,
		async close() {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
		},
	};
}

describe("OpenAICompatibleHandler local e2e", () => {
	const servers: Array<{ close: () => Promise<void> }> = [];

	afterEach(async () => {
		while (servers.length > 0) {
			await servers.pop()?.close();
		}
	});

	it("sends Anthropic automatic cache control and message markers over the wire for OpenRouter", async () => {
		const server = await startFakeOpenAICompatibleServer();
		servers.push(server);

		const handler = new OpenAICompatibleHandler({
			providerId: "openrouter",
			modelId: "anthropic/claude-sonnet-4.6",
			apiKey: "test-key",
			baseUrl: server.baseUrl,
			modelInfo: {
				id: "anthropic/claude-sonnet-4.6",
				pricing: {
					input: 3,
					output: 15,
					cacheRead: 0.3,
					cacheWrite: 3.75,
				},
			},
		});

		const chunks = await collect(
			handler.createMessage("system prompt", [
				{ role: "user", content: "first prompt" },
				{ role: "assistant", content: "working" },
				{ role: "user", content: "second prompt" },
			]),
		);

		expect(chunks.map((chunk) => chunk.type)).toEqual([
			"text",
			"usage",
			"done",
		]);
		expect(server.requests).toHaveLength(1);
		expect(server.requests[0]?.method).toBe("POST");
		expect(server.requests[0]?.url).toBe("/chat/completions");
		expect(server.requests[0]?.body).toMatchObject({
			model: "anthropic/claude-sonnet-4.6",
			stream: true,
			cache_control: { type: "ephemeral" },
			messages: [
				{ role: "system", content: "system prompt" },
				{ role: "user", content: "first prompt" },
				{ role: "assistant", content: "working" },
				{
					role: "user",
					content: "second prompt",
					cache_control: { type: "ephemeral" },
				},
			],
		});
	});

	it("does not send Anthropic cache signals over the wire for non-Anthropic models", async () => {
		const server = await startFakeOpenAICompatibleServer();
		servers.push(server);

		const handler = new OpenAICompatibleHandler({
			providerId: "openrouter",
			modelId: "google/gemma-4-31b-it",
			apiKey: "test-key",
			baseUrl: server.baseUrl,
			modelInfo: {
				id: "google/gemma-4-31b-it",
				capabilities: ["prompt-cache"],
			},
		});

		await collect(
			handler.createMessage("system prompt", [
				{ role: "user", content: "hello" },
			]),
		);

		expect(server.requests).toHaveLength(1);
		expect(server.requests[0]?.body).toMatchObject({
			model: "google/gemma-4-31b-it",
			messages: [
				{ role: "system", content: "system prompt" },
				{ role: "user", content: "hello" },
			],
		});
		expect(server.requests[0]?.body).not.toHaveProperty("cache_control");
	});

	it("keeps Anthropic message markers but omits automatic cache control for non-remapped providers", async () => {
		const server = await startFakeOpenAICompatibleServer();
		servers.push(server);

		const handler = new OpenAICompatibleHandler({
			providerId: "deepseek",
			modelId: "anthropic/claude-sonnet-4.6",
			apiKey: "test-key",
			baseUrl: server.baseUrl,
			modelInfo: {
				id: "anthropic/claude-sonnet-4.6",
				pricing: {
					input: 3,
					output: 15,
					cacheRead: 0.3,
					cacheWrite: 3.75,
				},
			},
		});

		await collect(
			handler.createMessage("system prompt", [
				{ role: "user", content: "hello" },
			]),
		);

		expect(server.requests).toHaveLength(1);
		expect(server.requests[0]?.body).toMatchObject({
			model: "anthropic/claude-sonnet-4.6",
			messages: [
				{ role: "system", content: "system prompt" },
				{
					role: "user",
					content: "hello",
					cache_control: { type: "ephemeral" },
				},
			],
		});
		expect(server.requests[0]?.body).not.toHaveProperty("cache_control");
	});
});
