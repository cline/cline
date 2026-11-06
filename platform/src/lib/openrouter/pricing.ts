import type { OpenRouterModel } from "@/lib/types";

export type TokenUsage = {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
};

export type CostBreakdown = {
	costUsd: number;
	pricing: {
		promptPerToken: number | null;
		completionPerToken: number | null;
		cacheReadPerToken: number | null;
		cacheWritePerToken: number | null;
	} | null;
	basis: "list-price" | "unknown";
};

/**
 * OpenRouter's /models response expresses prices as USD per token. When a model
 * is absent from discovery we return an unknown (0) cost instead of inventing one.
 */
export function computeCost(usage: TokenUsage, model: OpenRouterModel | null): CostBreakdown {
	if (!model) {
		return { costUsd: 0, pricing: null, basis: "unknown" };
	}
	const prompt = model.pricing.promptPerToken;
	const completion = model.pricing.completionPerToken;
	if (prompt === null && completion === null) {
		return { costUsd: 0, pricing: null, basis: "unknown" };
	}
	const cacheRead = prompt;
	const cacheWrite = prompt;
	const cost =
		usage.inputTokens * (prompt ?? 0) +
		usage.outputTokens * (completion ?? 0) +
		(usage.cacheReadTokens ?? 0) * (cacheRead ?? 0) +
		(usage.cacheWriteTokens ?? 0) * (cacheWrite ?? 0);
	return {
		costUsd: Number(cost.toFixed(8)),
		pricing: {
			promptPerToken: prompt,
			completionPerToken: completion,
			cacheReadPerToken: cacheRead,
			cacheWritePerToken: cacheWrite,
		},
		basis: "list-price",
	};
}

export function pricingSummary(model: OpenRouterModel): string {
	const prompt = model.pricing.promptPerMillion;
	const completion = model.pricing.completionPerMillion;
	if (prompt === null && completion === null) return "Pricing unavailable";
	const fmt = (value: number | null) =>
		value === null ? "?" : value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
	return `${fmt(prompt)} in / ${fmt(completion)} out per 1M tokens`;
}

export function contextLabel(tokens: number | null): string {
	if (!tokens) return "Context unknown";
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M context`;
	if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k context`;
	return `${tokens} context`;
}

export type OpenRouterErrorInfo = {
	status: number;
	code: string;
	message: string;
	retryable: boolean;
};

export function classifyOpenRouterError(status: number, body: string): OpenRouterErrorInfo {
	const detail = body.replace(/\s+/g, " ").slice(0, 240);
	switch (status) {
		case 400:
			return {
				status: 422,
				code: "model_request_invalid",
				message: `The selected model rejected the request. ${detail}`.trim(),
				retryable: false,
			};
		case 401:
			return {
				status: 502,
				code: "provider_auth_failed",
				message: "The server's OpenRouter credentials were rejected.",
				retryable: false,
			};
		case 402:
			return {
				status: 402,
				code: "provider_credits_exhausted",
				message: "OpenRouter reports insufficient credits for this request.",
				retryable: false,
			};
		case 403:
			return {
				status: 502,
				code: "provider_forbidden",
				message: "OpenRouter refused this request (model access restricted).",
				retryable: false,
			};
		case 408:
		case 504:
			return {
				status: 504,
				code: "provider_timeout",
				message: "The model provider timed out. Try again or pick another model.",
				retryable: true,
			};
		case 429:
			return {
				status: 429,
				code: "provider_rate_limited",
				message: "The model provider is rate-limiting requests. Try again shortly.",
				retryable: true,
			};
		default:
			return {
				status: 502,
				code: "provider_error",
				message:
					status >= 500
						? "The model provider is temporarily unavailable. Try again or pick another model."
						: `Provider request failed (${status}).`,
				retryable: status >= 500,
			};
	}
}
