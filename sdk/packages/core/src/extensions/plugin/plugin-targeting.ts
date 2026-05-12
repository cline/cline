import type { PluginManifest } from "@cline/shared";

export interface PluginTargeting {
	providerId?: string;
	modelId?: string;
}

export function matchesPluginManifestTargeting(
	manifest: PluginManifest | undefined,
	targeting: PluginTargeting | undefined,
): boolean {
	if (!manifest) {
		return true;
	}

	if (manifest.providerIds?.length) {
		if (
			!targeting?.providerId ||
			!manifest.providerIds.includes(targeting.providerId)
		) {
			return false;
		}
	}

	if (manifest.modelIds?.length) {
		if (!targeting?.modelId || !manifest.modelIds.includes(targeting.modelId)) {
			return false;
		}
	}

	return true;
}
