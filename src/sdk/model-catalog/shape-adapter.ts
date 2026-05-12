/**
 * Shape adapter: translates SDK-shaped model metadata into the extension's
 * {@link ModelInfo} shape. This is a boundary translation layer — it does
 * NOT import any SDK runtime (no `@clinebot/core` imports). It validates
 * unknown input and maps documented SDK fields onto `ModelInfo` fields.
 *
 * SDK shape captured by the Phase 2.1 spike (see `tmp/sdk-spike-findings.md`):
 *
 * ```ts
 * {
 *   id: string,                  // only consistently-required field
 *   name?: string,
 *   contextWindow?: number,
 *   maxTokens?: number,
 *   capabilities?: string[],     // e.g. ["tools", "reasoning", "prompt-cache", "images"]
 *   pricing?: { input?, output?, cacheRead?, cacheWrite? },
 *   description?: string,
 *   releaseDate?: string,        // not mapped — see "Unmapped SDK fields" below
 *   family?: string,             // not mapped
 *   status?: string,             // not mapped
 * }
 * ```
 *
 * Field mapping (extension <- SDK), with defaults sourced from
 * `openAiModelInfoSafeDefaults` ("SD"):
 *
 * | extension ModelInfo field | source | default if missing |
 * | --- | --- | --- |
 * | name | `sdk.name ?? sdk.id` | n/a (id is required) |
 * | contextWindow | `sdk.contextWindow` if finite number | SD.contextWindow (128_000) |
 * | maxTokens | `sdk.maxTokens` if finite number | SD.maxTokens (-1) |
 * | supportsImages | capabilities includes `images` or `vision` | SD.supportsImages (true) when capabilities absent |
 * | supportsPromptCache | capabilities includes `prompt-cache`; if capabilities absent, use SD | SD.supportsPromptCache (false) |
 * | supportsReasoning | capabilities includes `reasoning` | omitted (undefined) |
 * | inputPrice | `sdk.pricing.input` if finite number | SD.inputPrice (0) |
 * | outputPrice | `sdk.pricing.output` if finite number | SD.outputPrice (0) |
 * | cacheReadsPrice | `sdk.pricing.cacheRead` if finite number | omitted (undefined) |
 * | cacheWritesPrice | `sdk.pricing.cacheWrite` if finite number | omitted (undefined) |
 * | description | `sdk.description` if string | omitted (undefined) |
 *
 * Unmapped SDK fields intentionally dropped here: `releaseDate`, `family`,
 * `status`, and capabilities other than `images`/`vision`/`prompt-cache`/
 * `reasoning` (for example `tools`, `streaming`, `structured_output`,
 * `temperature`).
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

	const rawContextWindow = input.contextWindow
	if (rawContextWindow !== undefined && !isFiniteNumber(rawContextWindow)) {
		throw new CatalogShapeError("SDK model-info `contextWindow` must be a finite number when present.", {
			details: { receivedType: typeof rawContextWindow },
		})
	}

	const rawMaxTokens = input.maxTokens
	if (rawMaxTokens !== undefined && !isFiniteNumber(rawMaxTokens)) {
		throw new CatalogShapeError("SDK model-info `maxTokens` must be a finite number when present.", {
			details: { receivedType: typeof rawMaxTokens },
		})
	}

	const capabilities = readStringArray(input.capabilities)
	const pricing = readPricing(input.pricing)

	const result: ModelInfo = {
		name: rawName ?? id,
		contextWindow: isFiniteNumber(rawContextWindow) ? rawContextWindow : openAiModelInfoSafeDefaults.contextWindow,
		maxTokens: isFiniteNumber(rawMaxTokens) ? rawMaxTokens : openAiModelInfoSafeDefaults.maxTokens,
		supportsPromptCache: capabilities
			? capabilities.includes(PROMPT_CACHE_CAPABILITY)
			: openAiModelInfoSafeDefaults.supportsPromptCache,
		inputPrice: pricing?.input ?? openAiModelInfoSafeDefaults.inputPrice,
		outputPrice: pricing?.output ?? openAiModelInfoSafeDefaults.outputPrice,
	}

	if (capabilities) {
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

	return result
}
