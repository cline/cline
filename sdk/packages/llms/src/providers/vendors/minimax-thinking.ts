import type {
	LanguageModelV3CallOptions,
	LanguageModelV3Middleware,
} from "@ai-sdk/provider";

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
	const minimax =
		options.minimax && typeof options.minimax === "object"
			? (options.minimax as Record<string, unknown>)
			: undefined;
	const thinking =
		minimax?.thinking && typeof minimax.thinking === "object"
			? (minimax.thinking as Record<string, unknown>)
			: undefined;
	return typeof thinking?.type === "string" ? thinking.type : undefined;
}

export const miniMaxThinkingDisabledMiddleware: LanguageModelV3Middleware = {
	specificationVersion: "v3",
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
		} satisfies LanguageModelV3CallOptions;
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
		const shouldInject =
			headers.get(MINIMAX_THINKING_DISABLED_HEADER) === "1";
		if (!shouldInject) {
			return baseFetch(input, init);
		}

		headers.delete(MINIMAX_THINKING_DISABLED_HEADER);
		const body = await readBody(init?.body);
		const bodyRecord =
			body && typeof body === "object" && !Array.isArray(body)
				? (body as Record<string, unknown>)
				: undefined;
		const nextBody =
			bodyRecord && bodyRecord.thinking === undefined
				? writeBody({
						...bodyRecord,
						thinking: { type: "disabled" },
					})
				: init?.body;

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
