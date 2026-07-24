import { describe, expect, it } from "vitest";
import { createHandlerAsync, type ProviderConfig } from "../providers";

type ReasoningControl = { enabled: boolean };

type LiveCase = {
	label: string;
	config: ProviderConfig;
	expectedBody: Record<string, unknown>;
	unexpectedBodyKeys?: string[];
};

type LiveMetrics = {
	usageSeen: boolean;
	reasoningChunks: number;
};

type CapturedRequest = {
	url: string;
	body: unknown;
};

const LIVE_TEST_ENABLED = process.env.LLMS_LIVE_MINIMAX_ROUTING_TESTS === "1";
const PROVIDER_TIMEOUT_MS = Number(
	process.env.LLMS_LIVE_PROVIDER_TIMEOUT_MS ?? "120000",
);
const DEFAULT_PROMPT =
	"What is 12*13? Answer with only the number and no explanation.";

function readRequiredEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`Set ${name} to run MiniMax M3 live routing tests.`);
	}
	return value;
}

function makeConfig(options: {
	providerId: string;
	modelId: string;
	apiKeyEnv: string;
	reasoning: ReasoningControl;
	fetch: typeof fetch;
}): ProviderConfig {
	return {
		providerId: options.providerId,
		modelId: options.modelId,
		apiKey: readRequiredEnv(options.apiKeyEnv),
		fetch: options.fetch,
		thinking: options.reasoning.enabled,
		maxOutputTokens: 64,
	};
}

async function readRequestBody(
	body: unknown,
): Promise<Record<string, unknown>> {
	if (typeof body === "string") {
		return JSON.parse(body) as Record<string, unknown>;
	}
	if (body instanceof Uint8Array) {
		return JSON.parse(new TextDecoder().decode(body)) as Record<
			string,
			unknown
		>;
	}
	if (body instanceof ArrayBuffer) {
		return JSON.parse(new TextDecoder().decode(body)) as Record<
			string,
			unknown
		>;
	}
	return body && typeof body === "object"
		? (body as Record<string, unknown>)
		: {};
}

async function runLiveRequest(config: ProviderConfig): Promise<LiveMetrics> {
	const handler = await createHandlerAsync(config);
	const metrics: LiveMetrics = { usageSeen: false, reasoningChunks: 0 };
	const stream = handler.createMessage("You are concise.", [
		{ role: "user", content: DEFAULT_PROMPT },
	]);

	for await (const chunk of stream) {
		if (chunk.type === "usage") {
			metrics.usageSeen = true;
		}
		if (chunk.type === "reasoning") {
			metrics.reasoningChunks += 1;
		}
		if (chunk.type === "done" && !chunk.success) {
			throw new Error(chunk.error ?? "done chunk reported success=false");
		}
	}

	return metrics;
}

function buildCases(): LiveCase[] {
	const cases: LiveCase[] = [];
	const addCase = (options: {
		label: string;
		providerId: string;
		modelId: string;
		apiKeyEnv: string;
		reasoning: ReasoningControl;
		expectedBody: Record<string, unknown>;
		unexpectedBodyKeys?: string[];
	}) => {
		const captured: CapturedRequest[] = [];
		const captureFetch: typeof fetch = async (input, init) => {
			captured.push({ url: String(input), body: init?.body });
			return fetch(input, init);
		};
		const config = makeConfig({ ...options, fetch: captureFetch });
		cases.push({
			label: options.label,
			config: {
				...config,
				metadata: {
					...(config.metadata ?? {}),
					get capturedRequests() {
						return captured;
					},
				},
			},
			expectedBody: options.expectedBody,
			unexpectedBodyKeys: options.unexpectedBodyKeys,
		});
	};

	addCase({
		label: "direct MiniMax M3 reasoning enabled",
		providerId: "minimax",
		modelId: "MiniMax-M3",
		apiKeyEnv: "MINIMAX_API_KEY",
		reasoning: { enabled: true },
		expectedBody: { thinking: { type: "adaptive" } },
		unexpectedBodyKeys: [
			"reasoning",
			"effort",
			"reasoningEffort",
			"reasoningSummary",
		],
	});
	addCase({
		label: "direct MiniMax M3 reasoning disabled",
		providerId: "minimax",
		modelId: "MiniMax-M3",
		apiKeyEnv: "MINIMAX_API_KEY",
		reasoning: { enabled: false },
		expectedBody: { thinking: { type: "disabled" } },
		unexpectedBodyKeys: [
			"reasoning",
			"effort",
			"reasoningEffort",
			"reasoningSummary",
		],
	});
	addCase({
		label: "OpenRouter MiniMax M3 reasoning enabled",
		providerId: "openrouter",
		modelId: "minimax/minimax-m3",
		apiKeyEnv: "OPENROUTER_API_KEY",
		reasoning: { enabled: true },
		expectedBody: { reasoning: { enabled: true } },
		unexpectedBodyKeys: ["thinking"],
	});
	addCase({
		label: "OpenRouter MiniMax M3 reasoning disabled",
		providerId: "openrouter",
		modelId: "minimax/minimax-m3",
		apiKeyEnv: "OPENROUTER_API_KEY",
		reasoning: { enabled: false },
		expectedBody: { reasoning: { effort: "none" } },
		unexpectedBodyKeys: ["thinking"],
	});
	addCase({
		label: "Vercel AI Gateway MiniMax M3 reasoning enabled",
		providerId: "vercel-ai-gateway",
		modelId: "minimax/minimax-m3",
		apiKeyEnv: "AI_GATEWAY_API_KEY",
		reasoning: { enabled: true },
		expectedBody: { reasoning: { enabled: true } },
		unexpectedBodyKeys: ["thinking"],
	});
	addCase({
		label: "Vercel AI Gateway MiniMax M3 reasoning disabled",
		providerId: "vercel-ai-gateway",
		modelId: "minimax/minimax-m3",
		apiKeyEnv: "AI_GATEWAY_API_KEY",
		reasoning: { enabled: false },
		expectedBody: { reasoning: { exclude: true } },
		unexpectedBodyKeys: ["thinking"],
	});
	addCase({
		label: "Cline Gateway MiniMax M3 reasoning enabled",
		providerId: "cline",
		modelId: "minimax/minimax-m3",
		apiKeyEnv: "CLINE_API_KEY",
		reasoning: { enabled: true },
		expectedBody: { reasoning: { enabled: true } },
		unexpectedBodyKeys: ["thinking"],
	});
	addCase({
		label: "Cline Gateway MiniMax M3 reasoning disabled",
		providerId: "cline",
		modelId: "minimax/minimax-m3",
		apiKeyEnv: "CLINE_API_KEY",
		reasoning: { enabled: false },
		expectedBody: { reasoning: { enabled: false } },
		unexpectedBodyKeys: ["thinking"],
	});

	return cases;
}

function getCapturedRequests(config: ProviderConfig): CapturedRequest[] {
	const metadata = config.metadata as
		| { capturedRequests?: CapturedRequest[] }
		| undefined;
	return metadata?.capturedRequests ?? [];
}

describe("live MiniMax M3 provider routing mechanics", () => {
	const runLive = LIVE_TEST_ENABLED ? it : it.skip;

	runLive(
		"sends explicit reasoning controls for every MiniMax M3 route",
		async () => {
			const failures: string[] = [];

			for (const liveCase of buildCases()) {
				try {
					const metrics = await runLiveRequest(liveCase.config);
					expect(metrics.usageSeen, liveCase.label).toBe(true);
					const request = getCapturedRequests(liveCase.config).at(-1);
					expect(request, liveCase.label).toBeDefined();
					const body = await readRequestBody(request?.body);
					expect(body, liveCase.label).toEqual(
						expect.objectContaining(liveCase.expectedBody),
					);
					for (const key of liveCase.unexpectedBodyKeys ?? []) {
						expect(body, liveCase.label).not.toHaveProperty(key);
					}
				} catch (error) {
					failures.push(
						`${liveCase.label}: ${
							error instanceof Error ? error.message : String(error)
						}`,
					);
				}
			}

			if (failures.length > 0) {
				throw new Error(
					`MiniMax M3 routing failures (${failures.length}):\n${failures.join(
						"\n",
					)}`,
				);
			}
		},
		PROVIDER_TIMEOUT_MS,
	);
});
