import type { ModelInfo } from "@shared/api"
import { ApiFormat } from "@shared/proto/cline/models"

/** SDK string spelling of an API format (matches @cline/shared ApiFormatSchema). */
export type SdkApiFormatString = "r1" | "openai-responses" | "default"

export function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function positiveFiniteNumber(value: unknown): number | undefined {
	const number = finiteNumber(value)
	return number !== undefined && number > 0 ? number : undefined
}

export function nonNegativeFiniteNumber(value: unknown): number | undefined {
	const number = finiteNumber(value)
	return number !== undefined && number >= 0 ? number : undefined
}

export function toSdkApiFormat(apiFormat: ModelInfo["apiFormat"]): SdkApiFormatString | undefined {
	switch (apiFormat) {
		case ApiFormat.R1_CHAT:
			return "r1"
		case ApiFormat.OPENAI_RESPONSES:
			return "openai-responses"
		case ApiFormat.OPENAI_CHAT:
			return "default"
		default:
			return undefined
	}
}

export function fromSdkApiFormat(apiFormat: string | undefined): ModelInfo["apiFormat"] | undefined {
	switch (apiFormat) {
		case "r1":
			return ApiFormat.R1_CHAT
		case "openai-responses":
			return ApiFormat.OPENAI_RESPONSES
		case "default":
			return ApiFormat.OPENAI_CHAT
		default:
			return undefined
	}
}
