import {
	listProviders,
	resolveTopologyFromFacets,
	type ProfileFacetSeed,
} from "@cline/drive";
import {
	BUILTIN_PROVIDER_MANIFESTS,
	type DriveFacetValues,
	type DriveProviderManifest,
	type DriveProviderSlot,
	type ResolvedLlmEgress,
} from "@cline/shared";

export interface DriveSettingsProviderOption {
	readonly id: string;
	readonly title: string;
	readonly selectable: boolean;
	readonly disabledReason?: string;
}

/**
 * Pure model for Drive Settings provider pickers (ARD-0010).
 * UI renders this list; hub still validates on set.
 */
export function listDriveSettingsProviders(input: {
	facets: DriveFacetValues;
	llm: ResolvedLlmEgress;
	slot: DriveProviderSlot;
	registry?: readonly DriveProviderManifest[];
}): DriveSettingsProviderOption[] {
	const registry = input.registry ?? BUILTIN_PROVIDER_MANIFESTS;
	const resolved = resolveTopologyFromFacets({
		facets: input.facets,
		llm: input.llm,
		registry,
	});

	if (!resolved.ok) {
		return registry
			.filter((manifest) => manifest.slot === input.slot)
			.map((manifest) => ({
				id: manifest.id,
				title: manifest.title,
				selectable: false,
				disabledReason: resolved.message,
			}));
	}

	const allowed = new Set(
		listProviders(registry, input.slot, resolved.topology).map(
			(manifest) => manifest.id,
		),
	);

	return registry
		.filter((manifest) => manifest.slot === input.slot)
		.map((manifest) => {
			if (allowed.has(manifest.id)) {
				return {
					id: manifest.id,
					title: manifest.title,
					selectable: true,
				};
			}
			return {
				id: manifest.id,
				title: manifest.title,
				selectable: false,
				disabledReason: `Incompatible with ${input.facets["runtime.profile"]} profile / egress ceiling`,
			};
		});
}

export function summarizeProfileSeed(seed: ProfileFacetSeed): string {
	return `${seed["runtime.profile"]}: stt=${seed["providers.sttId"]} tts=${seed["providers.ttsId"]}`;
}
