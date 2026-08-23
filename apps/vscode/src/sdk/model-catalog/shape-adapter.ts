/**
 * Shape adapter: translates SDK-shaped model metadata into the extension's
 * {@link ModelInfo} shape. This is a boundary translation layer — it does
 * NOT import any SDK runtime (no `@cline/core` imports). It validates
 * unknown input and maps documented SDK fields onto `ModelInfo` fields.
 *
 * The SDK model-metadata shape this adapter reads from:
 *
 * ```ts
 * {
 *   id: string,                  // only consistently-required field
 *   name?: string,
 *   contextWindow?: number,
 *   maxInputTokens?: number,
 *   maxTokens?: number,
 *   capabilities?: string[],     // e.g. ["tools", "reasoning", "prompt-cache", "images"]
 *   modalities?: { input: string[], output: string[] },
 *   pricing?: { input?, output?, cacheRead?, cacheWrite? },
 *   description?: string,
 *   releaseDate?: string,        // not mapped — see "Unmapped SDK fields" below
 *   family?: string,             // not mapped
 *   status?: string,             // not mapped
 * }
 * ```
 *
 * Field mapping (extension <- SDK), with safe defaults sourced from
 * `openAiModelInfoSafeDefaults`:
 *
 * | extension ModelInfo field | source | default if missing |
 * | --- | --- | --- |
 * | name | `sdk.name ?? sdk.id` | n/a (id is required) |
 * | contextWindow | `sdk.contextWindow`, or positive `sdk.maxInputTokens` for legacy display compatibility | safe default: 128_000 |
 * | maxInputTokens | `sdk.maxInputTokens` if finite number (null = missing) | omitted (undefined) |
 * | maxTokens | `sdk.maxTokens` if finite number (null = missing) | safe default: -1 |
 * | supportsImages | capabilities includes `images` or `vision` | safe default: true when capabilities absent |
 * | supportsPromptCache | capabilities includes `prompt-cache` | safe default: false when capabilities absent |
 * | supportsReasoning | capabilities includes `reasoning` | omitted (undefined) |
 * | inputPrice | `sdk.pricing.input` if finite number | safe default: 0 |
 * | outputPrice | `sdk.pricing.output` if finite number | safe default: 0 |
 * | cacheReadsPrice | `sdk.pricing.cacheRead` if finite number | omitted (undefined) |
 * | cacheWritesPrice | `sdk.pricing.cacheWrite` if finite number | omitted (undefined) |
 * | description | `sdk.description` if string | omitted (undefined) |
 * | capabilities | `sdk.capabilities` preserved verbatim | omitted (undefined) |
 * | modalities | `sdk.modalities` preserved after validation | omitted (undefined) |
 * | operation modes | `sdk.operationModes` preserved after validation | omitted (undefined) |
 *
 * The full SDK capability list is preserved on `ModelInfo.capabilities` in
 * addition to the boolean projections above. The booleans exist for legacy
 * consumers; the preserved list is what flows back to the SDK runtime via
 * `toSdkModelInfo`, so capabilities without a boolean projection (`tools`,
 * `structured_output`, and any capability added by a future catalog) survive
 * the boundary round-trip.
 *
 * Unmapped SDK fields intentionally dropped here: `releaseDate`, `family`,
 * `status`.
 *
 * Extension-only fields not populated by this adapter: `thinkingConfig`,
 * `tiers`, `temperature`, `apiFormat`, `supportsGlobalEndpoint`, and local
 * provider loaded-context overrides. Those require host enrichment or upstream
 * SDK metadata rather than adapter guesses.
 */

import { type ModelInfo, openAiModelInfoSafeDefaults } from "@shared/api"

/**
 * Typed error thrown when SDK model-info shape validation fails. The catalog
 * layer translates this into the public `CatalogError` surface.
 */
export class CatalogShapeError extends Error {
	override readonly cause?: unknown
	readonly details?: Readonly<Record<string, unknown>>

	constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
		super(message)
		this.name = "CatalogShapeError"
		if (options?.cause !== undefined) {
			this.cause = options.cause
		}
		if (options?.details !== undefined) {
			this.details = Object.freeze({ ...options.details })
		}
	}
}

const IMAGE_CAPABILITIES = new Set(["images", "vision"])
const PROMPT_CACHE_CAPABILITY = "prompt-cache"
const REASONING_CAPABILITY = "reasoning"
const PRICING_KEYS = ["input", "output", "cacheRead", "cacheWrite"] as const
const MODEL_MODALITIES = new Set(["text", "image", "audio", "video", "pdf"])
const MODEL_OPERATIONS = new Set(["language", "image-generation", "speech-generation", "video-generation", "transcription"])
const MODEL_OPERATION_MODES = new Set(["batch", "streaming"])

interface NormalizedPricing {
	input?: number
	output?: number
	cacheRead?: number
	cacheWrite?: number
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value)
}

function readStringArray(value: unknown): readonly string[] | undefined {
	if (value === undefined) {
		return undefined
	}
	if (!Array.isArray(value)) {
		throw new CatalogShapeError("SDK model-info `capabilities` must be an array of strings when present.", {
			details: { receivedType: typeof value },
		})
	}
	for (const entry of value) {
		if (typeof entry !== "string") {
			throw new CatalogShapeError("SDK model-info `capabilities` must contain only strings.", {
				details: { offendingType: typeof entry },
			})
		}
	}
	return [...value]
}

function readPricing(value: unknown): NormalizedPricing | undefined {
	if (value === undefined) {
		return undefined
	}
	if (!isPlainObject(value)) {
		throw new CatalogShapeError("SDK model-info `pricing` must be an object when present.", {
			details: { receivedType: typeof value },
		})
	}

	const result: NormalizedPricing = {}
	for (const key of PRICING_KEYS) {
		const raw = value[key]
		if (raw === undefined || raw === null) {
			continue
		}
		if (!isFiniteNumber(raw)) {
			throw new CatalogShapeError(`SDK model-info \`pricing.${key}\` must be a finite number when present.`, {
				details: { key, receivedType: typeof raw },
			})
		}
		result[key] = raw
	}
	return result
}

function readModalities(value: unknown): NonNullable<ModelInfo["modalities"]> | undefined {
	if (value === undefined) {
		return undefined
	}
	if (!isPlainObject(value)) {
		throw new CatalogShapeError("SDK model-info `modalities` must be an object when present.", {
			details: { receivedType: typeof value },
		})
	}

	const readList = (key: "input" | "output") => {
		const raw = value[key]
		if (!Array.isArray(raw)) {
			throw new CatalogShapeError(`SDK model-info \`modalities.${key}\` must be an array when present.`, {
				details: { key, receivedType: typeof raw },
			})
		}
		for (const modality of raw) {
			if (typeof modality !== "string" || !MODEL_MODALITIES.has(modality)) {
				throw new CatalogShapeError(`SDK model-info \`modalities.${key}\` contains an unsupported modality.`, {
					details: { key, modality },
				})
			}
		}
		return [...raw] as NonNullable<ModelInfo["modalities"]>[typeof key]
	}

	return { input: readList("input"), output: readList("output") }
}

/**
 * Adapt an SDK model-info shape into the extension's {@link ModelInfo} shape.
 *
 * Throws {@link CatalogShapeError} when `input` is not a plain object, when
 * `id` is missing/non-string/empty, or when present-but-malformed fields
 * violate the documented SDK shape. The catalog layer translates these into
 * `CatalogError`.
 *
 * Does not mutate `input`.
 */
export function adaptSdkModelInfo(input: unknown): ModelInfo {
	if (!isPlainObject(input)) {
		throw new CatalogShapeError("SDK model-info must be a non-null object.", {
			details: { receivedType: input === null ? "null" : typeof input },
		})
	}

	const id = input.id
	if (typeof id !== "string" || id.length === 0) {
		throw new CatalogShapeError("SDK model-info is missing required non-empty string `id`.", {
			details: { idType: typeof id },
		})
	}

	const rawName = input.name
	if (rawName !== undefined && typeof rawName !== "string") {
		throw new CatalogShapeError("SDK model-info `name` must be a string when present.", {
			details: { receivedType: typeof rawName },
		})
	}

	const rawDescription = input.description
	if (rawDescription !== undefined && typeof rawDescription !== "string") {
		throw new CatalogShapeError("SDK model-info `description` must be a string when present.", {
			details: { receivedType: typeof rawDescription },
		})
	}

	// Live provider catalogs (e.g. a LiteLLM proxy's /model/info) report
	// unknown limits as explicit nulls; treat null like "missing" (same as
	// pricing below) so one such model doesn't fail the whole catalog.
	const rawContextWindow = input.contextWindow
	if (rawContextWindow !== undefined && rawContextWindow !== null && !isFiniteNumber(rawContextWindow)) {
		throw new CatalogShapeError("SDK model-info `contextWindow` must be a finite number when present.", {
			details: { receivedType: typeof rawContextWindow },
		})
	}

	const rawMaxInputTokens = input.maxInputTokens
	if (rawMaxInputTokens !== undefined && rawMaxInputTokens !== null && !isFiniteNumber(rawMaxInputTokens)) {
		throw new CatalogShapeError("SDK model-info `maxInputTokens` must be a finite number when present.", {
			details: { receivedType: typeof rawMaxInputTokens },
		})
	}

	const rawMaxTokens = input.maxTokens
	if (rawMaxTokens !== undefined && rawMaxTokens !== null && !isFiniteNumber(rawMaxTokens)) {
		throw new CatalogShapeError("SDK model-info `maxTokens` must be a finite number when present.", {
			details: { receivedType: typeof rawMaxTokens },
		})
	}

	const capabilities = readStringArray(input.capabilities)
	const pricing = readPricing(input.pricing)
	const modalities = readModalities(input.modalities)
	const operation = input.operation
	if (operation !== undefined && (typeof operation !== "string" || !MODEL_OPERATIONS.has(operation))) {
		throw new CatalogShapeError("SDK model-info `operation` is unsupported when present.", {
			details: { operation },
		})
	}
	const operationModes = readStringArray(input.operationModes)
	if (operationModes?.some((mode) => !MODEL_OPERATION_MODES.has(mode))) {
		throw new CatalogShapeError("SDK model-info `operationModes` contains an unsupported mode.", {
			details: { operationModes },
		})
	}

	const maxInputTokens = isFiniteNumber(rawMaxInputTokens) ? rawMaxInputTokens : undefined
	// Legacy extension consumers display and budget exclusively from
	// `contextWindow`. When a provider reports only a positive prompt limit,
	// use it as a conservative compatibility proxy while still preserving the
	// authoritative `maxInputTokens` field independently for the SDK runtime.
	const contextWindow = isFiniteNumber(rawContextWindow)
		? rawContextWindow
		: maxInputTokens !== undefined && maxInputTokens > 0
			? maxInputTokens
			: openAiModelInfoSafeDefaults.contextWindow

	const result: ModelInfo = {
		name: rawName ?? id,
		contextWindow,
		maxTokens: isFiniteNumber(rawMaxTokens) ? rawMaxTokens : openAiModelInfoSafeDefaults.maxTokens,
		supportsPromptCache: capabilities
			? capabilities.includes(PROMPT_CACHE_CAPABILITY)
			: openAiModelInfoSafeDefaults.supportsPromptCache,
		inputPrice: pricing?.input ?? openAiModelInfoSafeDefaults.inputPrice,
		outputPrice: pricing?.output ?? openAiModelInfoSafeDefaults.outputPrice,
	}
	if (maxInputTokens !== undefined) {
		result.maxInputTokens = maxInputTokens
	}

	if (capabilities) {
		result.capabilities = capabilities
		result.supportsImages = capabilities.some((capability) => IMAGE_CAPABILITIES.has(capability))
		if (capabilities.includes(REASONING_CAPABILITY)) {
			result.supportsReasoning = true
		}
	} else {
		result.supportsImages = openAiModelInfoSafeDefaults.supportsImages
	}

	if (pricing?.cacheRead !== undefined) {
		result.cacheReadsPrice = pricing.cacheRead
	}
	if (pricing?.cacheWrite !== undefined) {
		result.cacheWritesPrice = pricing.cacheWrite
	}
	if (rawDescription !== undefined) {
		result.description = rawDescription
	}
	if (modalities !== undefined) {
		result.modalities = modalities
	}
	if (operation !== undefined) {
		result.operation = operation as NonNullable<ModelInfo["operation"]>
	}
	if (operationModes !== undefined) {
		result.operationModes = operationModes as NonNullable<ModelInfo["operationModes"]>
	}

	return result
}
