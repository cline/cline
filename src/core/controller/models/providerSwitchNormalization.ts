import { type ApiConfiguration, type ApiProvider, deepSeekDefaultModelId } from "@/shared/api"

type ProviderSwitchConfig = Partial<
	Pick<ApiConfiguration, "planModeApiProvider" | "actModeApiProvider" | "planModeApiModelId" | "actModeApiModelId">
>

const modeFields = {
	plan: {
		provider: "planModeApiProvider",
		modelId: "planModeApiModelId",
	},
	act: {
		provider: "actModeApiProvider",
		modelId: "actModeApiModelId",
	},
} as const

/**
 * Keep the legacy generic model-id slot coherent when switching to a migrated
 * provider whose picker resolves its selection through the provider catalog.
 *
 * DeepSeek still uses the generic `*ModeApiModelId` keys. If the user switches
 * Cline/Anthropic/etc. → DeepSeek without explicitly choosing a model, the
 * generic slot can still hold a stale model from the previous provider. Reset
 * it to DeepSeek's default so the picker fallback, chat status line, and next
 * runtime config agree immediately.
 */
export function normalizeDeepSeekProviderSwitch<T extends ProviderSwitchConfig>(previous: ProviderSwitchConfig, next: T): T {
	const normalized: ProviderSwitchConfig = { ...next }

	for (const fields of Object.values(modeFields)) {
		const previousProvider = previous[fields.provider] as ApiProvider | undefined
		const nextProvider = (normalized[fields.provider] ?? previousProvider) as ApiProvider | undefined
		const previousModelId = previous[fields.modelId]
		const nextModelId = normalized[fields.modelId]

		if (
			previousProvider !== "deepseek" &&
			nextProvider === "deepseek" &&
			(nextModelId === undefined || nextModelId === previousModelId)
		) {
			normalized[fields.modelId] = deepSeekDefaultModelId
		}
	}

	return normalized as T
}
