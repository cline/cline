import type { ModelInfo } from "./provider-settings";

/**
 * Maps the DotHoosh gateway's `/v1/models` listing (OpenAI list shape with
 * OpenRouter-style fields) to Cline model metadata. The gateway is the single
 * source of truth for models, limits and prices, so nothing here is a
 * per-model constant.
 */

interface DotHooshModelEntry {
	id?: string;
	name?: string;
	status?: string;
	removal_at?: string;
	context_length?: number;
	context_window?: number;
	max_output_tokens?: number;
	top_provider?: {
		context_length?: number;
		max_completion_tokens?: number;
	};
	architecture?: { input_modalities?: string[] };
	// USD per single token, as decimal strings (OpenRouter convention).
	pricing?: Record<string, number | string | undefined>;
	supported_parameters?: string[];
	protocols?: Array<string | { protocol?: string }>;
}

export interface DotHooshModelsPayload {
	data?: Array<DotHooshModelEntry | null>;
}

const TOKENS_PER_MILLION = 1_000_000;

function positiveInt(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: undefined;
}

/** Per-token USD string -> USD per million tokens; undefined when unusable. */
function perMillion(value: unknown): number | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}
	const perToken = Number(value);
	if (!Number.isFinite(perToken) || perToken < 0) {
		return undefined;
	}
	// Round away binary float noise (0.00000125 * 1e6 = 1.2500000000000002).
	return Number((perToken * TOKENS_PER_MILLION).toPrecision(12));
}

function mapPricing(
	pricing: DotHooshModelEntry["pricing"],
): ModelInfo["pricing"] {
	const mapped = {
		input: perMillion(pricing?.prompt),
		output: perMillion(pricing?.completion),
		cacheRead: perMillion(pricing?.input_cache_read),
		cacheWrite: perMillion(pricing?.input_cache_write),
	};
	const defined = Object.entries(mapped).filter(([, v]) => v !== undefined);
	return defined.length > 0 ? Object.fromEntries(defined) : undefined;
}

function stringList(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((v): v is string => typeof v === "string")
		: [];
}

function protocolNames(entry: DotHooshModelEntry): string[] {
	if (!Array.isArray(entry.protocols)) {
		return [];
	}
	return entry.protocols.flatMap((p) => {
		const name = typeof p === "string" ? p : p?.protocol;
		return name ? [name] : [];
	});
}

/**
 * Listing lifecycle -> Cline model status. `unavailable` models are not
 * routable, so they are left out of the picker; limited and degraded models
 * still serve traffic.
 */
function lifecycleStatus(status: unknown): ModelInfo["status"] | "skip" {
	switch (status) {
		case "unavailable":
			return "skip";
		case "deprecated":
		case "removal-scheduled":
			return "deprecated";
		default:
			return "active";
	}
}

export function mapDotHooshModels(
	payload: DotHooshModelsPayload | undefined,
): Record<string, ModelInfo> {
	const entries: Array<[string, ModelInfo]> = [];
	const data = Array.isArray(payload?.data) ? payload.data : [];
	for (const entry of data) {
		const id = typeof entry?.id === "string" ? entry.id.trim() : "";
		if (!entry || !id) {
			continue;
		}
		const status = lifecycleStatus(entry.status);
		if (status === "skip") {
			continue;
		}
		const contextWindow =
			positiveInt(entry.context_length) ??
			positiveInt(entry.context_window) ??
			positiveInt(entry.top_provider?.context_length);
		const maxTokens =
			positiveInt(entry.max_output_tokens) ??
			positiveInt(entry.top_provider?.max_completion_tokens);
		const parameters = stringList(entry.supported_parameters);
		const pricing = mapPricing(entry.pricing);

		const capabilities: NonNullable<ModelInfo["capabilities"]> = ["streaming"];
		if (parameters.includes("tools")) capabilities.push("tools");
		if (parameters.includes("reasoning")) capabilities.push("reasoning");
		if (
			parameters.includes("response_format") ||
			parameters.includes("structured_outputs")
		) {
			capabilities.push("structured_output");
		}
		if (stringList(entry.architecture?.input_modalities).includes("image")) {
			capabilities.push("images");
		}
		if (pricing?.cacheRead !== undefined || pricing?.cacheWrite !== undefined) {
			capabilities.push("prompt-cache");
		}

		// Models served on the Responses API go there first: GPT-6 chat
		// completions admit function tools only in narrow cases, Responses
		// admits them always. Chat-only and chat+Anthropic models stay on chat.
		const responsesFirst = protocolNames(entry).includes("openai-responses");

		entries.push([
			id,
			{
				id,
				name: entry.name?.trim() || id,
				contextWindow,
				maxInputTokens: contextWindow,
				maxTokens,
				capabilities,
				pricing,
				status,
				...(typeof entry.removal_at === "string" && entry.removal_at
					? { deprecationDate: entry.removal_at }
					: {}),
				...(responsesFirst
					? { metadata: { apiProtocol: "openai-responses" } }
					: {}),
			},
		]);
	}
	// fromEntries defines own properties, so ids such as "__proto__" cannot
	// rewrite the prototype of the catalog object.
	return Object.fromEntries(entries);
}

/**
 * Default model derived from the live catalog (listing order): the first
 * active model that can call tools, else the first active one, else the first.
 */
export function pickDotHooshDefaultModel(
	models: Record<string, ModelInfo>,
): string | undefined {
	const all = Object.values(models);
	const active = all.filter((m) => m.status !== "deprecated");
	return (
		active.find((m) => m.capabilities?.includes("tools"))?.id ??
		active[0]?.id ??
		all[0]?.id
	);
}
