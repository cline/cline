// Wire-contract tests for the gateway's synthesized output cap on Anthropic,
// exercised through the real `ai` and `@ai-sdk/anthropic` packages against a
// local HTTP server. AI SDK's portable `reasoning` option selects
// thinking/effort but keeps an explicit `maxOutputTokens`, so the gateway cap
// is what reaches the wire as `max_tokens`. These cases pin that the cap is
// the model's full output budget only when the resolved reasoning policy is
// adaptive.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { GatewayStreamRequest, ModelReasoningOption } from "@cline/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGateway, DEFAULT_GATEWAY_MAX_OUTPUT_FRACTION } from "./gateway";

const MAX_OUTPUT_TOKENS = 128_000;

let server: Server;
let baseUrl: string;
const requestBodies: Record<string, unknown>[] = [];

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let data = "";
		req.on("data", (chunk) => {
			data += chunk;
		});
		req.on("end", () => resolve(data));
		req.on("error", reject);
	});
}

beforeAll(async () => {
	server = createServer(async (req, res) => {
		const raw = await readBody(req);
		requestBodies.push(raw ? JSON.parse(raw) : {});
		res.writeHead(400, { "content-type": "application/json" });
		res.end(
			JSON.stringify({
				type: "error",
				error: { type: "invalid_request_error", message: "stub" },
			}),
		);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

/**
 * Stream one turn and return the request body that reached the server.
 * The server answers 400: only the request is under test.
 */
async function wireRequest(input: {
	modelId: string;
	reasoningOptions?: readonly ModelReasoningOption[];
	reasoning: GatewayStreamRequest["reasoning"];
}): Promise<Record<string, unknown>> {
	const before = requestBodies.length;
	const gateway = createGateway({
		providerConfigs: [
			{
				providerId: "anthropic",
				apiKey: "test-key",
				baseUrl,
				models: [
					{
						id: input.modelId,
						name: input.modelId,
						contextWindow: 1_000_000,
						maxOutputTokens: MAX_OUTPUT_TOKENS,
						capabilities: ["reasoning"],
						...(input.reasoningOptions
							? { reasoningOptions: input.reasoningOptions }
							: {}),
					},
				],
			},
		],
	});
	try {
		for await (const _event of await gateway.stream({
			providerId: "anthropic",
			modelId: input.modelId,
			reasoning: input.reasoning,
			messages: [
				{
					id: "m1",
					role: "user",
					content: [{ type: "text", text: "hi" }],
					createdAt: 0,
				},
			],
		})) {
			// drain
		}
	} catch {
		// The stub's 400 may surface as a thrown error; only the request matters.
	}
	const body = requestBodies[before];
	if (!body) {
		throw new Error("no request reached the server");
	}
	return body;
}

describe("anthropic adaptive-thinking max_tokens on the wire", () => {
	it("sends the full output budget for adaptive thinking", async () => {
		const body = await wireRequest({
			modelId: "claude-opus-5-5",
			reasoning: { effort: "high" },
		});
		expect(body.max_tokens).toBe(MAX_OUTPUT_TOKENS);
		expect(body.thinking).toMatchObject({ type: "adaptive" });
	});

	it.each([
		// No catalog controls: an unlisted Claude alias with an explicit budget
		// is routed to manual thinking.
		["claude-custom-proxy", undefined],
		// Catalog advertises a budget control only.
		[
			"claude-sonnet-4-5",
			[{ type: "budget_tokens", min: 1_024 }] as ModelReasoningOption[],
		],
	])("keeps the fractional cap for manual thinking on %s", async (modelId, reasoningOptions) => {
		const body = await wireRequest({
			modelId,
			reasoningOptions,
			reasoning: { enabled: true, budgetTokens: 8_000 },
		});
		// @ai-sdk/anthropic adds a manual budget on top of maxOutputTokens, so
		// the wire max_tokens is the fractional gateway cap plus the budget.
		expect(body.max_tokens).toBe(
			Math.floor(MAX_OUTPUT_TOKENS * DEFAULT_GATEWAY_MAX_OUTPUT_FRACTION) +
				8_000,
		);
		expect(body.thinking).toMatchObject({
			type: "enabled",
			budget_tokens: 8_000,
		});
	});
});
