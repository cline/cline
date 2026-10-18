import { ApiError } from "@/lib/api";
import type { ModelsResponse, OpenRouterModel } from "@/lib/types";

type RawModel = {
	id?: unknown;
	name?: unknown;
	description?: unknown;
	created?: unknown;
	context_length?: unknown;
	architecture?: {
		input_modalities?: unknown;
		output_modalities?: unknown;
		modality?: unknown;
	};
	pricing?: Record<string, unknown>;
	top_provider?: {
		context_length?: unknown;
		max_completion_tokens?: unknown;
		is_moderated?: unknown;
	};
	supported_parameters?: unknown;
};

type CacheEntry = { at: number; models: OpenRouterModel[] };

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: CacheEntry | null = null;
let inFlight: Promise<OpenRouterModel[]> | null = null;

function numberOrNull(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function titleCase(value: string): string {
	return value
		.split(/[-_.]/g)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

export function normalizeOpenRouterModels(payload: unknown): OpenRouterModel[] {
	const raw =
		payload && typeof payload === "object" && "data" in payload
			? (payload as { data?: unknown }).data
			: payload;
	if (!Array.isArray(raw)) {
		throw new Error("OpenRouter returned an unexpected models payload");
	}

	const models: OpenRouterModel[] = [];
	for (const item of raw as RawModel[]) {
		if (typeof item.id !== "string" || item.id.length === 0) continue;
		const provider = item.id.includes("/") ? item.id.split("/")[0] : "openrouter";
		const supported = stringArray(item.supported_parameters);
		const prompt = numberOrNull(item.pricing?.prompt);
		const completion = numberOrNull(item.pricing?.completion);
		const request = numberOrNull(item.pricing?.request);
		const inputModalities = stringArray(item.architecture?.input_modalities);
		if (inputModalities.length === 0 && typeof item.architecture?.modality === "string") {
			// Legacy `modality` looks like "text+image->text"; only the inputs matter.
			const [inputs] = item.architecture.modality.split("->");
			inputModalities.push(...(inputs ?? "").split("+").filter(Boolean));
		}
		const contextLength =
			numberOrNull(item.context_length) ?? numberOrNull(item.top_provider?.context_length);

		models.push({
			id: item.id,
			name: typeof item.name === "string" && item.name.trim() ? item.name : item.id,
			description: typeof item.description === "string" ? item.description : null,
			contextLength,
			maxCompletionTokens: numberOrNull(item.top_provider?.max_completion_tokens),
			provider,
			supportsTools: supported.includes("tools"),
			// OpenRouter streams chat completions for its text models; tool support
			// is the capability that genuinely varies between them.
			supportsStreaming: true,
			inputModalities,
			pricing: {
				promptPerToken: prompt,
				completionPerToken: completion,
				request,
				promptPerMillion: prompt === null ? null : prompt * 1_000_000,
				completionPerMillion: completion === null ? null : completion * 1_000_000,
			},
			moderated: item.top_provider?.is_moderated === true,
			created: numberOrNull(item.created),
		});
	}

	models.sort((a, b) => a.name.localeCompare(b.name));
	return models;
}

function openRouterHeaders(): Record<string, string> {
	const headers: Record<string, string> = {
		Accept: "application/json",
		"HTTP-Referer":
			process.env.OPENROUTER_SITE_URL ?? process.env.APP_URL ?? "http://localhost:3000",
		"X-Title": process.env.OPENROUTER_APP_NAME ?? "21 Agent",
	};
	if (process.env.OPENROUTER_API_KEY) {
		headers.Authorization = `Bearer ${process.env.OPENROUTER_API_KEY}`;
	}
	return headers;
}

export async function fetchOpenRouterModels(options?: { force?: boolean }): Promise<{
	models: OpenRouterModel[];
	fetchedAt: string;
}> {
	if (!options?.force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
		return { models: cache.models, fetchedAt: new Date(cache.at).toISOString() };
	}
	if (inFlight) {
		const models = await inFlight;
		return { models, fetchedAt: new Date(cache?.at ?? Date.now()).toISOString() };
	}

	const baseUrl = (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(
		/\/$/,
		"",
	);

	inFlight = (async () => {
		const response = await fetch(`${baseUrl}/models`, {
			headers: openRouterHeaders(),
			signal: AbortSignal.timeout(20_000),
			cache: "no-store",
		});
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new ApiError(
				502,
				"models_unavailable",
				`OpenRouter model discovery failed (${response.status}). ${text.slice(0, 180)}`.trim(),
			);
		}
		const payload = (await response.json()) as unknown;
		const models = normalizeOpenRouterModels(payload);
		cache = { at: Date.now(), models };
		return models;
	})().finally(() => {
		inFlight = null;
	});

	try {
		const models = await inFlight;
		return { models, fetchedAt: new Date(cache?.at ?? Date.now()).toISOString() };
	} catch (error) {
		if (error instanceof ApiError) throw error;
		const message = error instanceof Error ? error.message : String(error);
		throw new ApiError(
			502,
			"models_unavailable",
			message.includes("abort") || message.includes("timeout")
				? "OpenRouter model discovery timed out. Try again in a moment."
				: "Could not reach OpenRouter model discovery.",
		);
	}
}

export function filterModels(
	models: OpenRouterModel[],
	query: { search?: string; provider?: string; toolsOnly?: boolean; minContext?: number },
): OpenRouterModel[] {
	const search = query.search?.trim().toLowerCase();
	return models.filter((model) => {
		if (query.toolsOnly && !model.supportsTools) return false;
		if (query.provider && model.provider !== query.provider) return false;
		if (query.minContext && (model.contextLength ?? 0) < query.minContext) return false;
		if (!search) return true;
		return (
			model.id.toLowerCase().includes(search) ||
			model.name.toLowerCase().includes(search) ||
			model.provider.toLowerCase().includes(search)
		);
	});
}

export async function getModelById(modelId: string): Promise<OpenRouterModel | null> {
	const { models } = await fetchOpenRouterModels();
	return models.find((model) => model.id === modelId) ?? null;
}

export function toModelsResponse(
	models: OpenRouterModel[],
	configured: boolean,
	fetchedAt: string,
	total: number,
	error?: string,
): ModelsResponse {
	return {
		models,
		configured,
		source: "openrouter",
		fetchedAt,
		total,
		...(error ? { error } : {}),
	};
}

export function providerLabel(provider: string): string {
	return titleCase(provider);
}
