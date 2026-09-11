import type {
	LanguageModelV4CallOptions,
	LanguageModelV4StreamPart,
	LanguageModelV4StreamResult,
} from "@ai-sdk/provider";
import type {
	AgentModelEvent,
	AgentToolDefinition,
	BasicLogger,
	GatewayProvider,
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOllamaProvider } from "./ai-sdk";

const ollamaDoStreamMock = vi.hoisted(() =>
	vi.fn<
		(
			modelId: string,
			options: LanguageModelV4CallOptions,
		) => Promise<LanguageModelV4StreamResult>
	>(),
);

vi.mock("ollama-ai-provider-v2", () => ({
	createOllama: () => ({
		chat: (modelId: string) => ({
			specificationVersion: "v4",
			provider: "ollama",
			modelId,
			supportedUrls: {},
			doGenerate: async () => {
				throw new Error("doGenerate is not used by the streaming path");
			},
			doStream: (options: LanguageModelV4CallOptions) =>
				ollamaDoStreamMock(modelId, options),
		}),
	}),
}));

const READ_FILES_TOOL: AgentToolDefinition = {
	name: "read_files",
	description: "Read files",
	inputSchema: {
		type: "object",
		properties: {
			files: { type: "array", items: { type: "string" } },
		},
		required: ["files"],
	},
};

const USAGE = {
	inputTokens: {
		total: 1,
		noCache: undefined,
		cacheRead: undefined,
		cacheWrite: undefined,
	},
	outputTokens: { total: 1, text: undefined, reasoning: undefined },
} as never;

function textStream(text = "hello"): LanguageModelV4StreamResult {
	const parts: LanguageModelV4StreamPart[] = [
		{ type: "stream-start", warnings: [] },
		{ type: "text-start", id: "text" },
		{ type: "text-delta", id: "text", delta: text },
		{ type: "text-end", id: "text" },
		{
			type: "finish",
			finishReason: { unified: "stop", raw: "stop" },
			usage: USAGE,
		},
	];
	return {
		stream: new ReadableStream({
			start(controller) {
				for (const part of parts) controller.enqueue(part);
				controller.close();
			},
		}),
	};
}

function request(modelId: string): GatewayStreamRequest {
	return {
		providerId: "ollama",
		modelId,
		messages: [
			{
				id: `message-${modelId}`,
				role: "user",
				content: [{ type: "text", text: "read a file" }],
				createdAt: new Date(),
			},
		],
		tools: [READ_FILES_TOOL],
	} as unknown as GatewayStreamRequest;
}

function context(
	modelId: string,
	logger?: BasicLogger,
): GatewayProviderContext {
	const model = { id: modelId, name: modelId, providerId: "ollama" };
	return {
		provider: {
			id: "ollama",
			name: "Ollama",
			defaultModelId: modelId,
			models: [model],
		},
		model,
		config: { providerId: "ollama" },
		logger,
	} as GatewayProviderContext;
}

type OllamaCapabilities = readonly string[] | undefined;

function metadataFetch(
	resolveCapabilities: (
		modelId: string,
	) => OllamaCapabilities | Promise<OllamaCapabilities>,
): typeof fetch {
	return vi.fn(async (input, init) => {
		expect(String(input)).toBe("http://localhost:11434/api/show");
		const { model } = JSON.parse(String(init?.body)) as { model: string };
		const capabilities = await resolveCapabilities(model);
		return Response.json(capabilities ? { capabilities } : {});
	}) as unknown as typeof fetch;
}

async function collect(
	iterable: AsyncIterable<AgentModelEvent>,
): Promise<AgentModelEvent[]> {
	const events: AgentModelEvent[] = [];
	for await (const event of iterable) events.push(event);
	return events;
}

async function runRequest(
	provider: GatewayProvider,
	modelId: string,
	logger?: BasicLogger,
): Promise<AgentModelEvent[]> {
	return collect(
		await provider.stream(request(modelId), context(modelId, logger)),
	);
}

function callOptionsFor(modelId: string): LanguageModelV4CallOptions {
	const call = ollamaDoStreamMock.mock.calls.find(([id]) => id === modelId);
	if (!call) throw new Error(`No Ollama call captured for ${modelId}`);
	return call[1];
}

beforeEach(() => {
	ollamaDoStreamMock.mockReset();
	ollamaDoStreamMock.mockImplementation(async () => textStream());
});

describe("Ollama selected-model tool capabilities", () => {
	it("sends native tools when the selected model advertises tools", async () => {
		const provider = await createOllamaProvider({
			providerId: "ollama",
			fetch: metadataFetch(() => ["completion", "tools"]),
		});

		await runRequest(provider, "capable");

		expect(callOptionsFor("capable").tools).toEqual(
			expect.arrayContaining([expect.objectContaining({ name: "read_files" })]),
		);
	});

	it("omits tools when the selected model does not advertise them", async () => {
		const provider = await createOllamaProvider({
			providerId: "ollama",
			fetch: metadataFetch(() => ["completion"]),
		});

		await runRequest(provider, "incapable");

		expect(callOptionsFor("incapable").tools).toBeUndefined();
	});

	it("fails closed for unknown metadata while preserving text generation", async () => {
		const provider = await createOllamaProvider({
			providerId: "ollama",
			fetch: metadataFetch(() => undefined),
		});

		const events = await runRequest(provider, "unknown");

		expect(callOptionsFor("unknown").tools).toBeUndefined();
		expect(events).toContainEqual(
			expect.objectContaining({ type: "text-delta", text: "hello" }),
		);
	});

	it("logs metadata failures, omits tools, and still generates text", async () => {
		const fetch = vi.fn(async () => {
			throw new Error("metadata offline");
		}) as unknown as typeof globalThis.fetch;
		const provider = await createOllamaProvider({
			providerId: "ollama",
			fetch,
		});
		const logger = {
			debug: vi.fn(),
			log: vi.fn(),
			error: vi.fn(),
		} satisfies BasicLogger;

		const events = await runRequest(provider, "failed", logger);

		expect(callOptionsFor("failed").tools).toBeUndefined();
		expect(events).toContainEqual(
			expect.objectContaining({ type: "text-delta", text: "hello" }),
		);
		expect(logger.log).toHaveBeenCalledWith(
			expect.stringContaining("tool capability metadata"),
			expect.objectContaining({
				providerId: "ollama",
				modelId: "failed",
				severity: "warn",
			}),
		);
	});

	it("uses fresh metadata when the selected model changes", async () => {
		const fetch = metadataFetch((modelId) =>
			modelId === "capable" ? ["completion", "tools"] : ["completion"],
		);
		const provider = await createOllamaProvider({
			providerId: "ollama",
			fetch,
		});

		await runRequest(provider, "capable");
		await runRequest(provider, "incapable");

		expect(callOptionsFor("capable").tools).toEqual(
			expect.arrayContaining([expect.objectContaining({ name: "read_files" })]),
		);
		expect(callOptionsFor("incapable").tools).toBeUndefined();
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("keeps concurrent selected-model snapshots isolated", async () => {
		const slowStarted = Promise.withResolvers<void>();
		const releaseSlow = Promise.withResolvers<void>();
		const fetch = metadataFetch(async (modelId) => {
			if (modelId === "slow-capable") {
				slowStarted.resolve();
				await releaseSlow.promise;
				return ["completion", "tools"];
			}
			return ["completion"];
		});
		const provider = await createOllamaProvider({
			providerId: "ollama",
			fetch,
		});

		const slowRequest = runRequest(provider, "slow-capable");
		await slowStarted.promise;
		await runRequest(provider, "fast-incapable");
		releaseSlow.resolve();
		await slowRequest;

		expect(ollamaDoStreamMock.mock.calls.map(([modelId]) => modelId)).toEqual([
			"fast-incapable",
			"slow-capable",
		]);

		expect(callOptionsFor("slow-capable").tools).toEqual(
			expect.arrayContaining([expect.objectContaining({ name: "read_files" })]),
		);
		expect(callOptionsFor("fast-incapable").tools).toBeUndefined();
	});
});
