import type {
	LanguageModelV4CallOptions,
	LanguageModelV4Middleware,
} from "@ai-sdk/provider";

import {
	MINIMAX_EFFORTS,
	MINIMAX_FLASH_MODEL_ID,
	MINIMAX_MAX_OUTPUT_TOKENS,
	MINIMAX_PROVIDER_IDS,
} from "../../catalog/catalog-minimax";
import { toProviderOptionsKey } from "../routing/utils";

export const MINIMAX_THINKING_DISABLED_HEADER =
	"x-cline-minimax-thinking-disabled";

type FetchWithOptionalPreconnect = typeof fetch & {
	preconnect?: (...args: unknown[]) => unknown;
};

function getMiniMaxThinkingType(providerOptions: unknown): string | undefined {
	const options =
		providerOptions && typeof providerOptions === "object"
			? (providerOptions as Record<string, unknown>)
			: {};
	const bucket = MINIMAX_PROVIDER_IDS.map(
		(id) => options[id] ?? options[toProviderOptionsKey(id)],
	).find((value) => value && typeof value === "object");
	const minimax = bucket as Record<string, unknown> | undefined;
	const thinking =
		minimax?.thinking && typeof minimax.thinking === "object"
			? (minimax.thinking as Record<string, unknown>)
			: undefined;
	return typeof thinking?.type === "string" ? thinking.type : undefined;
}

export const miniMaxThinkingDisabledMiddleware: LanguageModelV4Middleware = {
	specificationVersion: "v4",
	transformParams: async ({ params }) => {
		if (getMiniMaxThinkingType(params.providerOptions) !== "disabled") {
			return params;
		}

		return {
			...params,
			headers: {
				...params.headers,
				[MINIMAX_THINKING_DISABLED_HEADER]: "1",
			},
		} satisfies LanguageModelV4CallOptions;
	},
};

async function readBody(
	body: NonNullable<Parameters<typeof fetch>[1]>["body"],
): Promise<unknown> {
	if (typeof body === "string") {
		return JSON.parse(body) as unknown;
	}
	if (body instanceof Uint8Array) {
		return JSON.parse(new TextDecoder().decode(body)) as unknown;
	}
	if (body instanceof ArrayBuffer) {
		return JSON.parse(new TextDecoder().decode(body)) as unknown;
	}
	return undefined;
}

function writeBody(body: unknown): string {
	return JSON.stringify(body);
}

export function createMiniMaxThinkingFetch(baseFetch: typeof fetch = fetch) {
	const wrappedFetch = (async (
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1],
	) => {
		const headers = new Headers(init?.headers);
		const shouldInject = headers.get(MINIMAX_THINKING_DISABLED_HEADER) === "1";
		headers.delete(MINIMAX_THINKING_DISABLED_HEADER);
		const body = await readBody(init?.body);
		const bodyRecord =
			body && typeof body === "object" && !Array.isArray(body)
				? (body as Record<string, unknown>)
				: undefined;
		const isFlash = bodyRecord?.model === MINIMAX_FLASH_MODEL_ID;
		const isM3 = bodyRecord?.model === "MiniMax-M3";
		if (bodyRecord && (isFlash || isM3)) {
			const maxTokens = bodyRecord.max_tokens;
			if (
				maxTokens !== undefined &&
				(typeof maxTokens !== "number" ||
					!Number.isInteger(maxTokens) ||
					maxTokens < 1 ||
					maxTokens > MINIMAX_MAX_OUTPUT_TOKENS)
			) {
				throw new RangeError(
					`MiniMax max_tokens must be an integer between 1 and ${MINIMAX_MAX_OUTPUT_TOKENS}`,
				);
			}
			const outputConfig =
				bodyRecord.output_config && typeof bodyRecord.output_config === "object"
					? { ...(bodyRecord.output_config as Record<string, unknown>) }
					: {};
			if (isFlash) {
				bodyRecord.thinking = { type: "adaptive" };
				delete bodyRecord.service_tier;
				outputConfig.effort =
					MINIMAX_EFFORTS.find((effort) => effort === outputConfig.effort) ??
					"max";
				bodyRecord.output_config = outputConfig;
			} else {
				if (shouldInject) bodyRecord.thinking = { type: "disabled" };
				delete outputConfig.effort;
				if (Object.keys(outputConfig).length)
					bodyRecord.output_config = outputConfig;
				else delete bodyRecord.output_config;
			}
		}
		const nextBody =
			bodyRecord && (isFlash || isM3) ? writeBody(bodyRecord) : init?.body;

		return baseFetch(input, {
			...init,
			headers,
			body: nextBody,
		});
	}) as typeof fetch;
	const sourceFetch = baseFetch as FetchWithOptionalPreconnect;
	(wrappedFetch as FetchWithOptionalPreconnect).preconnect =
		typeof sourceFetch.preconnect === "function"
			? sourceFetch.preconnect.bind(baseFetch)
			: () => {};

	return wrappedFetch;
}
