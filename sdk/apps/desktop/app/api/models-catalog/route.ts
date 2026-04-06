import * as Llms from "@clinebot/llms";
import { NextResponse } from "next/server";

export const dynamic = "force-static";

const FALLBACK_PROVIDER_MODELS: Record<string, string[]> = {
	cline: ["anthropic/claude-sonnet-4.6"],
	anthropic: ["claude-sonnet-4-6"],
	openai: ["gpt-5.3-codex"],
	openrouter: ["anthropic/claude-sonnet-4.6"],
	gemini: ["gemini-2.5-pro"],
};

const FALLBACK_PROVIDER_REASONING_MODELS: Record<string, string[]> = {
	cline: ["anthropic/claude-sonnet-4.6"],
	anthropic: ["claude-sonnet-4-6"],
	openai: ["gpt-5.3-codex"],
	openrouter: ["anthropic/claude-sonnet-4.6"],
	gemini: ["gemini-2.5-pro"],
};

const MODELS_DEV_PROVIDER_KEY_MAP: Record<string, string> = {
	anthropic: "anthropic",
	google: "gemini",
	openai: "openai-native",
	openrouter: "openrouter",
	vercel: "vercel-ai-gateway",
};

const MODELS_DEV_URL = "https://models.dev/api.json";

function toReasoningModelIds(
	models: Record<string, unknown> | undefined,
): string[] {
	if (!models) {
		return [];
	}
	return Object.entries(models)
		.filter(([, info]) => {
			if (!info || typeof info !== "object") {
				return false;
			}
			const modelInfo = info as {
				capabilities?: unknown;
				thinkingConfig?: unknown;
			};
			if (
				Array.isArray(modelInfo.capabilities) &&
				modelInfo.capabilities.includes("reasoning")
			) {
				return true;
			}
			return modelInfo.thinkingConfig != null;
		})
		.map(([modelId]) => modelId);
}

function toModelIds(models: Record<string, unknown> | undefined): string[] {
	if (!models) {
		return [];
	}
	return Object.keys(models);
}

function uniqueSorted(values: string[]): string[] {
	return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function getCatalogModels(providerId: string): Record<string, unknown> {
	return Llms.MODEL_COLLECTIONS_BY_PROVIDER_ID[providerId]?.models ?? {};
}

async function getLiveProviderModels(): Promise<
	Record<string, Record<string, unknown>>
> {
	const response = await fetch(MODELS_DEV_URL, { next: { revalidate: 3600 } });
	if (!response.ok) {
		throw new Error(`Failed to fetch models catalog: ${response.status}`);
	}

	const body = (await response.json()) as {
		data?: Array<{
			id?: string;
			models?: Array<{
				id?: string;
			}>;
		}>;
	};
	const data = Array.isArray(body.data) ? body.data : [];

	const liveByProvider: Record<string, Record<string, unknown>> = {};
	for (const entry of data) {
		const sourceId = entry.id;
		if (!sourceId) {
			continue;
		}
		const providerId = MODELS_DEV_PROVIDER_KEY_MAP[sourceId];
		if (!providerId) {
			continue;
		}
		const providerModels = liveByProvider[providerId] ?? {};
		for (const model of entry.models ?? []) {
			if (!model.id) {
				continue;
			}
			providerModels[model.id] = model;
		}
		liveByProvider[providerId] = providerModels;
	}

	return liveByProvider;
}

export async function GET() {
	const providerModels: Record<string, string[]> = {
		cline: uniqueSorted([
			...toModelIds(getCatalogModels("cline")),
			...FALLBACK_PROVIDER_MODELS.cline,
		]),
		anthropic: uniqueSorted([
			...toModelIds(getCatalogModels("anthropic")),
			...FALLBACK_PROVIDER_MODELS.anthropic,
		]),
		openai: uniqueSorted([
			...toModelIds(getCatalogModels("openai-native")),
			...FALLBACK_PROVIDER_MODELS.openai,
		]),
		openrouter: uniqueSorted([
			...toModelIds(getCatalogModels("openrouter")),
			...FALLBACK_PROVIDER_MODELS.openrouter,
		]),
		gemini: uniqueSorted([
			...toModelIds(getCatalogModels("gemini")),
			...FALLBACK_PROVIDER_MODELS.gemini,
		]),
	};
	const providerReasoningModels: Record<string, string[]> = {
		cline: uniqueSorted([
			...toReasoningModelIds(getCatalogModels("cline")),
			...FALLBACK_PROVIDER_REASONING_MODELS.cline,
		]),
		anthropic: uniqueSorted([
			...toReasoningModelIds(getCatalogModels("anthropic")),
			...FALLBACK_PROVIDER_REASONING_MODELS.anthropic,
		]),
		openai: uniqueSorted([
			...toReasoningModelIds(getCatalogModels("openai-native")),
			...FALLBACK_PROVIDER_REASONING_MODELS.openai,
		]),
		openrouter: uniqueSorted([
			...toReasoningModelIds(getCatalogModels("openrouter")),
			...FALLBACK_PROVIDER_REASONING_MODELS.openrouter,
		]),
		gemini: uniqueSorted([
			...toReasoningModelIds(getCatalogModels("gemini")),
			...FALLBACK_PROVIDER_REASONING_MODELS.gemini,
		]),
	};

	try {
		const liveCatalog = await getLiveProviderModels();
		for (const [providerId, providerCatalog] of Object.entries(liveCatalog)) {
			const modelIds = toModelIds(providerCatalog);
			const reasoningModelIds = toReasoningModelIds(providerCatalog);
			if (modelIds.length === 0) {
				continue;
			}
			if (providerId === "vercel-ai-gateway" || providerId === "cline") {
				providerModels.cline = uniqueSorted([
					...(providerModels.cline ?? []),
					...modelIds,
				]);
				providerReasoningModels.cline = uniqueSorted([
					...(providerReasoningModels.cline ?? []),
					...reasoningModelIds,
				]);
				continue;
			}
			if (providerId === "openai-native") {
				providerModels.openai = uniqueSorted([
					...(providerModels.openai ?? []),
					...modelIds,
				]);
				providerReasoningModels.openai = uniqueSorted([
					...(providerReasoningModels.openai ?? []),
					...reasoningModelIds,
				]);
				continue;
			}
			if (!providerModels[providerId]) {
				continue;
			}
			providerModels[providerId] = uniqueSorted([
				...(providerModels[providerId] ?? []),
				...modelIds,
			]);
			providerReasoningModels[providerId] = uniqueSorted([
				...(providerReasoningModels[providerId] ?? []),
				...reasoningModelIds,
			]);
		}
	} catch {
		// Return fallback/static models when live catalog cannot be fetched.
	}

	return NextResponse.json({ providerModels, providerReasoningModels });
}
