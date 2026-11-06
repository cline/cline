import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type {
	LanguageModelV4,
	LanguageModelV4FunctionTool,
	LanguageModelV4Middleware,
} from "@ai-sdk/provider";
import { createProviderDefinedToolFactory } from "@ai-sdk/provider-utils";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import {
	modelProducesImages,
	usesImageGenerationOperation,
} from "@cline/shared";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { wrapLanguageModel } from "ai";
import { z } from "zod";
import { ensureFetch, resolveApiKey } from "../http";
import { splitToolImagesMiddleware } from "../middleware/split-tool-images";
import {
	createSuccessDataResponseFetch,
	withMaxCompletionTokensForReasoningModels,
} from "./openai-compatible";
import type { ProviderFactoryResult } from "./types";

export interface ClineWebSearchInput {
	query: string;
	allowed_domains?: string[];
	blocked_domains?: string[];
}

export interface ClineWebSearchResult {
	results: Array<{ title?: string; url?: string }>;
}

export interface ClineWebSearchOptions {
	allowedDomains?: string[];
	blockedDomains?: string[];
}

export interface ClineProviderOptions {
	apiKey?: string;
	baseURL: string;
	headers?: Record<string, string>;
	fetch?: typeof fetch;
	onResponseError?: (response: Response) => Promise<void> | void;
}

const CLINE_WEB_SEARCH_INPUT_SCHEMA: LanguageModelV4FunctionTool["inputSchema"] =
	{
		type: "object",
		properties: {
			query: {
				type: "string",
				description: "The search query.",
			},
			allowed_domains: {
				type: "array",
				items: { type: "string" },
				description: "Optional domains to restrict results to.",
			},
			blocked_domains: {
				type: "array",
				items: { type: "string" },
				description: "Optional domains to exclude from results.",
			},
		},
		required: ["query"],
		additionalProperties: false,
	};

const ClineWebSearchInputSchema = z.object({
	query: z.string().min(1),
	allowed_domains: z.array(z.string()).optional(),
	blocked_domains: z.array(z.string()).optional(),
});

const webSearchFactory = createProviderDefinedToolFactory<
	ClineWebSearchInput,
	ClineWebSearchOptions
>({
	id: "cline.web_search",
	inputSchema: ClineWebSearchInputSchema,
});

function withoutTrailingSlash(value: string): string {
	return value.endsWith("/") ? value.slice(0, -1) : value;
}

function normalizeDomains(value: string[] | undefined): string[] | undefined {
	const domains = value?.map((domain) => domain.trim()).filter(Boolean);
	return domains?.length ? domains : undefined;
}

function createClineFetch(
	options: ClineProviderOptions,
	normalizeDsml = true,
): typeof fetch {
	const baseFetch = ensureFetch(options.fetch);
	return (async (input, init) => {
		const response = await baseFetch(input, init);
		await options.onResponseError?.(response);
		return normalizeDsml && isChatCompletionRequest(input)
			? normalizeLeakedDsmlResponse(response)
			: response;
	}) as typeof fetch;
}

function isChatCompletionRequest(input: Parameters<typeof fetch>[0]): boolean {
	try {
		const url = new URL(
			input instanceof Request ? input.url : input.toString(),
		);
		return url.pathname.endsWith("/chat/completions");
	} catch {
		return false;
	}
}

const DSML_PREFIX = String.raw`(?:[|｜]\s*){0,2}`;
const DSML_TAG = String.raw`<\s*${DSML_PREFIX}DSML\s*${DSML_PREFIX}`;
const DSML_INVOKE_PATTERN = new RegExp(
	String.raw`${DSML_TAG}invoke\b[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\s*/\s*${DSML_PREFIX}DSML\s*${DSML_PREFIX}inv(?:oke)?\s*>`,
	"gi",
);
const DSML_PARAMETER_PATTERN = new RegExp(
	String.raw`${DSML_TAG}parameter\b([^>]*)>([\s\S]*?)<\s*/\s*${DSML_PREFIX}DSML\s*${DSML_PREFIX}parameter\s*>`,
	"gi",
);
const DSML_WRAPPER_PATTERN = new RegExp(
	String.raw`<\s*/*\s*${DSML_PREFIX}DSML\s*${DSML_PREFIX}(?:tool_calls|invoke|parameter)\b[^>]*>`,
	"gi",
);

interface DsmlToolCall {
	name: string;
	input: Record<string, unknown>;
}

function normalizeLeakedDsmlResponse(response: Response): Promise<Response> {
	const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
	if (
		!response.ok ||
		(!contentType.includes("json") && !contentType.includes("event-stream"))
	) {
		return Promise.resolve(response);
	}
	return response.text().then((text) => {
		const normalized = contentType.includes("event-stream")
			? normalizeDsmlSse(text)
			: normalizeDsmlJson(text);
		return createResponse(response, normalized ?? text);
	});
}

function createResponse(response: Response, body: string): Response {
	const headers = new Headers(response.headers);
	headers.delete("content-encoding");
	headers.delete("content-length");
	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function parseDsmlToolCalls(content: string): DsmlToolCall[] | undefined {
	const calls: DsmlToolCall[] = [];
	for (const match of content.matchAll(DSML_INVOKE_PATTERN)) {
		const input: Record<string, unknown> = {};
		for (const parameter of match[2].matchAll(DSML_PARAMETER_PATTERN)) {
			const name = /\bname\s*=\s*["']([^"']+)["']/i.exec(parameter[1])?.[1];
			const stringValue = /\bstring\s*=\s*["']([^"']+)["']/i.exec(
				parameter[1],
			)?.[1];
			if (!name || !stringValue) {
				return undefined;
			}
			const value = parameter[2].trim();
			if (stringValue.toLowerCase() === "true") {
				input[name] = value;
				continue;
			}
			try {
				input[name] = JSON.parse(value) as unknown;
			} catch {
				return undefined;
			}
		}
		calls.push({ name: match[1], input });
	}
	return calls.length > 0 ? calls : undefined;
}

function stripDsmlMarkup(content: string): string {
	return content
		.replace(DSML_INVOKE_PATTERN, "")
		.replace(DSML_WRAPPER_PATTERN, "")
		.trim();
}

function normalizeDsmlJson(text: string): string | undefined {
	if (!text.includes("DSML")) {
		return undefined;
	}
	let payload: Record<string, unknown>;
	try {
		payload = JSON.parse(text) as Record<string, unknown>;
	} catch {
		return undefined;
	}
	const choices = Array.isArray(payload.choices) ? payload.choices : [];
	const choice = choices[0] as Record<string, unknown> | undefined;
	const message = choice?.message as Record<string, unknown> | undefined;
	const content = typeof message?.content === "string" ? message.content : "";
	const toolCalls = parseDsmlToolCalls(content);
	if (!toolCalls) {
		return undefined;
	}
	return JSON.stringify({
		...payload,
		choices: choices.map((candidate, index) =>
			index === 0
				? {
						...(candidate as Record<string, unknown>),
						message: {
							...message,
							content: stripDsmlMarkup(content) || null,
							tool_calls: toolCalls.map((call, callIndex) => ({
								id: `call_dsml_${callIndex}`,
								type: "function",
								function: {
									name: call.name,
									arguments: JSON.stringify(call.input),
								},
							})),
						},
						finish_reason: "tool_calls",
					}
				: candidate,
		),
	});
}

function normalizeDsmlSse(text: string): string | undefined {
	if (!text.includes("DSML")) {
		return undefined;
	}
	const events = text.split(/\r?\n\r?\n/);
	const payloads: Array<Record<string, unknown>> = [];
	for (const event of events) {
		const data = event
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trim())
			.join("\n");
		if (!data || data === "[DONE]") {
			continue;
		}
		try {
			payloads.push(JSON.parse(data) as Record<string, unknown>);
		} catch {
			return undefined;
		}
	}
	const content = payloads
		.flatMap((payload) =>
			Array.isArray(payload.choices) ? payload.choices : [],
		)
		.map((choice) => (choice as Record<string, unknown>).delta)
		.map((delta) => (delta as Record<string, unknown> | undefined)?.content)
		.filter((value): value is string => typeof value === "string")
		.join("");
	const toolCalls = parseDsmlToolCalls(content);
	if (!toolCalls || payloads.length === 0) {
		return undefined;
	}
	const first = payloads[0];
	const last = payloads[payloads.length - 1];
	const base = { id: first.id, created: first.created, model: first.model };
	const output = [
		`data: ${JSON.stringify({
			...base,
			choices: [
				{
					index: 0,
					delta: {
						role: "assistant",
						...(stripDsmlMarkup(content)
							? { content: stripDsmlMarkup(content) }
							: {}),
					},
				},
			],
		})}`,
	];
	for (const [index, call] of toolCalls.entries()) {
		output.push(
			`data: ${JSON.stringify({
				...base,
				choices: [
					{
						index: 0,
						delta: {
							tool_calls: [
								{
									index,
									id: `call_dsml_${index}`,
									type: "function",
									function: {
										name: call.name,
										arguments: JSON.stringify(call.input),
									},
								},
							],
						},
					},
				],
			})}`,
		);
	}
	output.push(
		`data: ${JSON.stringify({
			...base,
			choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
			...(last.usage ? { usage: last.usage } : {}),
		})}`,
	);
	output.push("data: [DONE]");
	return `${output.join("\n\n")}\n\n`;
}

async function executeWebSearch(
	input: ClineWebSearchInput,
	options: ClineWebSearchOptions,
	provider: ClineProviderOptions,
	abortSignal?: AbortSignal,
): Promise<ClineWebSearchResult> {
	const allowedDomains = normalizeDomains(
		input.allowed_domains ?? options.allowedDomains,
	);
	const blockedDomains = normalizeDomains(
		input.blocked_domains ?? options.blockedDomains,
	);
	if (allowedDomains && blockedDomains) {
		throw new Error(
			"web_search accepts allowed domains or blocked domains, but not both.",
		);
	}

	const response = await createClineFetch(provider)(
		`${withoutTrailingSlash(provider.baseURL)}/search/websearch`,
		{
			method: "POST",
			headers: {
				...(provider.apiKey
					? { Authorization: `Bearer ${provider.apiKey}` }
					: {}),
				"Content-Type": "application/json",
				...provider.headers,
			},
			body: JSON.stringify({
				query: input.query,
				...(allowedDomains ? { allowed_domains: allowedDomains } : {}),
				...(blockedDomains ? { blocked_domains: blockedDomains } : {}),
			}),
			signal: abortSignal,
		},
	);
	const body = await response.text();
	if (!response.ok) {
		throw new Error(
			`Cline web search failed (HTTP ${response.status}): ${body || response.statusText}`,
		);
	}

	const parsed = body ? (JSON.parse(body) as unknown) : {};
	const result = parsed as {
		data?: { results?: Array<{ title?: string; url?: string }> };
	};
	return {
		results: Array.isArray(result.data?.results) ? result.data.results : [],
	};
}

function createClineProviderToolMiddleware(): LanguageModelV4Middleware {
	return {
		specificationVersion: "v4",
		transformParams: async ({ params }) => ({
			...params,
			tools: params.tools?.map((tool) => {
				if (tool.type !== "provider" || tool.id !== "cline.web_search") {
					return tool;
				}
				return {
					type: "function",
					name: tool.name,
					description:
						"Search the public web for current information and return matching pages.",
					inputSchema: CLINE_WEB_SEARCH_INPUT_SCHEMA,
				} satisfies LanguageModelV4FunctionTool;
			}),
		}),
	};
}

export interface ClineProvider {
	(modelId: string): LanguageModelV4;
	tools: {
		webSearch(
			options?: ClineWebSearchOptions,
		): ReturnType<typeof webSearchFactory<ClineWebSearchResult>>;
	};
}

/** Create the Cline AI SDK provider, including Cline-native client tools. */
export function createCline(options: ClineProviderOptions): ClineProvider {
	const providerFetch = createClineFetch(options);
	const compatible = createOpenAICompatible({
		// Both Cline gateway providers ("cline" and "cline-pass") share this AI
		// SDK provider and the same Cline API; option routing keys their
		// providerOptions to the "cline" bucket (see buildProviderAndAliasPatch).
		name: "cline",
		baseURL: withoutTrailingSlash(options.baseURL),
		apiKey: options.apiKey,
		headers: options.headers,
		fetch: providerFetch,
		includeUsage: true,
		transformRequestBody: withMaxCompletionTokensForReasoningModels,
	});
	const createModel = (modelId: string): LanguageModelV4 =>
		wrapLanguageModel({
			model: wrapLanguageModel({
				model: compatible(modelId),
				middleware: createClineProviderToolMiddleware(),
			}),
			middleware: splitToolImagesMiddleware,
		});
	const cline = ((modelId: string) => createModel(modelId)) as ClineProvider;
	cline.tools = {
		webSearch: (toolOptions = {}) =>
			webSearchFactory<ClineWebSearchResult>({
				...toolOptions,
				execute: (input, execution) =>
					executeWebSearch(input, toolOptions, options, execution.abortSignal),
			}),
	};
	return cline;
}

function readResponseErrorHandler(
	config: GatewayResolvedProviderConfig,
): ClineProviderOptions["onResponseError"] {
	const candidate = config.options?.onResponseError;
	return typeof candidate === "function"
		? (candidate as ClineProviderOptions["onResponseError"])
		: undefined;
}

export async function createClineProviderModule(
	config: GatewayResolvedProviderConfig,
	context: GatewayProviderContext,
): Promise<ProviderFactoryResult> {
	const providerOptions: ClineProviderOptions = {
		apiKey: await resolveApiKey(config),
		baseURL: config.baseUrl ?? "https://api.cline.bot/api/v1",
		headers: config.headers,
		fetch: config.fetch,
		onResponseError: readResponseErrorHandler(config),
	};
	const cline = createCline(providerOptions);
	const openRouter =
		context.provider.metadata?.imageTransport === "openrouter"
			? createOpenRouter({
					apiKey: providerOptions.apiKey,
					baseURL: providerOptions.baseURL,
					headers: providerOptions.headers,
					fetch: createSuccessDataResponseFetch(
						createClineFetch(providerOptions, false),
					),
					compatibility: "compatible",
				})
			: undefined;
	return {
		operations: {
			language: (modelId) =>
				openRouter &&
				modelProducesImages(context.model) &&
				!usesImageGenerationOperation(context.model)
					? openRouter.chat(modelId)
					: cline(modelId),
			...(openRouter
				? {
						imageGeneration: (modelId: string) =>
							openRouter.imageModel(modelId),
					}
				: {}),
		},
		buildModelTools: (tools) => {
			const result: ReturnType<
				NonNullable<ProviderFactoryResult["buildModelTools"]>
			> = {};
			for (const tool of tools) {
				if (tool.name === "web_search") {
					result.web_search = {
						tool: cline.tools.webSearch({
							allowedDomains: tool.allowedDomains,
							blockedDomains: tool.blockedDomains,
						}),
					};
				}
			}
			return result;
		},
		executesModelTools: true,
	};
}
