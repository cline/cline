// Wire-contract tests for SAP AI Core, exercised through the real
// `@jerome-benoit/sap-ai-provider` and SAP AI SDK clients against a local
// HTTP server that serves both the OAuth token and the inference endpoints.
// Each case streams one turn through the gateway and asserts on the inference
// request body. Together they pin:
//
//   1. the output limit is sent as `max_completion_tokens`, never the
//      deprecated `max_tokens`, which OpenAI reasoning models reject and
//      newer SAP AI Core landscapes reject for every model family;
//   2. no `reasoning_effort` is sent, whatever reasoning setting the request
//      carries. SAP AI Core requests have never carried one, so reasoning
//      settings saved meanwhile would otherwise start reaching models that
//      reject the parameter; sending it needs its own change.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { GatewayStreamRequest } from "@cline/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGateway } from "../gateway";

const DEPLOYMENT_ID = "d0123456789abcde";

interface RecordedRequest {
	path: string;
	body: Record<string, unknown>;
}

let server: Server;
let baseUrl: string;
const inferenceRequests: RecordedRequest[] = [];

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

function base64Url(value: object): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

// The SAP SDK reads the token's expiry from its JWT payload.
const ACCESS_TOKEN = [
	base64Url({ alg: "none", typ: "JWT" }),
	base64Url({ exp: Math.floor(Date.now() / 1000) + 3600, zid: "test-zone" }),
	"",
].join(".");

beforeAll(async () => {
	server = createServer(async (req, res) => {
		const raw = await readBody(req);
		const path = req.url ?? "";
		if (path.startsWith("/oauth/token")) {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(
				JSON.stringify({
					access_token: ACCESS_TOKEN,
					token_type: "bearer",
					expires_in: 3600,
				}),
			);
			return;
		}
		inferenceRequests.push({ path, body: raw ? JSON.parse(raw) : {} });
		res.writeHead(400, { "content-type": "application/json" });
		res.end(JSON.stringify({ error: { message: "stub" } }));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

/**
 * Stream one turn and return the inference request that reached the server.
 * The server answers 400: only the request is under test.
 */
async function wireRequest(input: {
	modelId: string;
	useOrchestrationMode: boolean;
	reasoning?: GatewayStreamRequest["reasoning"];
}): Promise<RecordedRequest> {
	const before = inferenceRequests.length;
	const gateway = createGateway({
		providerConfigs: [
			{
				providerId: "sapaicore",
				baseUrl,
				options: {
					clientId: "sap-client",
					clientSecret: "sap-secret",
					tokenUrl: baseUrl,
					deploymentId: DEPLOYMENT_ID,
					useOrchestrationMode: input.useOrchestrationMode,
				},
			},
		],
	});
	for await (const _event of await gateway.stream({
		providerId: "sapaicore",
		modelId: input.modelId,
		reasoning: input.reasoning,
		maxTokens: 16,
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
	const request = inferenceRequests[before];
	if (!request) {
		throw new Error("no inference request reached the server");
	}
	return request;
}

/** Collect every key in a nested request body, for shape-agnostic checks. */
function keysOf(value: unknown, keys = new Map<string, unknown>()) {
	if (value && typeof value === "object") {
		for (const [key, child] of Object.entries(value)) {
			keys.set(key, child);
			keysOf(child, keys);
		}
	}
	return keys;
}

const MODELS = ["gpt-5.4", "gpt-4o", "anthropic--claude-4.5-sonnet"];
const REASONING: Array<GatewayStreamRequest["reasoning"]> = [
	undefined,
	{ enabled: false },
	{ enabled: true, effort: "high" },
];

describe.each([
	{ api: "foundation models", useOrchestrationMode: false },
	{ api: "orchestration", useOrchestrationMode: true },
])("SAP AI Core $api wire contract", ({ useOrchestrationMode }) => {
	it.each(
		MODELS.flatMap((modelId) =>
			REASONING.map((reasoning) => ({ modelId, reasoning })),
		),
	)("sends max_completion_tokens and no reasoning_effort for $modelId with reasoning $reasoning", async ({
		modelId,
		reasoning,
	}) => {
		const request = await wireRequest({
			modelId,
			useOrchestrationMode,
			reasoning,
		});
		const keys = keysOf(request.body);

		expect(request.path).toContain(
			`/v2/inference/deployments/${DEPLOYMENT_ID}`,
		);
		expect(keys.get("max_completion_tokens")).toBe(16);
		expect(keys.has("max_tokens")).toBe(false);
		expect(keys.has("reasoning_effort")).toBe(false);
	});
});
