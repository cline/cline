import type { ApiConfiguration } from "@/shared/api"

type ProviderSwitchConfig = Partial<
	Pick<ApiConfiguration, "planModeApiProvider" | "actModeApiProvider" | "planModeApiModelId" | "actModeApiModelId">
>

export function normalizeProviderSwitchModel<T extends ProviderSwitchConfig>(
	_store: unknown,
	_previous: ProviderSwitchConfig,
	next: T,
): T {
	return next
}
