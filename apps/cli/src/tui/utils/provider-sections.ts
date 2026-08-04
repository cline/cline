export const POPULAR_PROVIDER_SECTION = "Popular";
export const OTHER_PROVIDER_SECTION = "Other";

export type ProviderSection =
	| typeof POPULAR_PROVIDER_SECTION
	| typeof OTHER_PROVIDER_SECTION;

export interface ProviderSectionItem {
	capabilities?: readonly string[] | null;
}

export function isPopularProvider(provider: ProviderSectionItem): boolean {
	return provider.capabilities?.includes("popular") ?? false;
}

export function getProviderSection(
	provider: ProviderSectionItem,
): ProviderSection {
	return isPopularProvider(provider)
		? POPULAR_PROVIDER_SECTION
		: OTHER_PROVIDER_SECTION;
}
