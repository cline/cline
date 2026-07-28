import type {
	DriveFacetValues,
	DriveProviderManifest,
	ResolvedLlmEgress,
	RuntimeTopology,
	SttBackend,
	TtsBackend,
} from "@cline/shared";
import { assertProviderCompatible } from "./assertProviderCompatible.js";
import { assertTopologyLegal } from "./assertTopologyLegal.js";
import { seedFacetsForProfile } from "./seedFacetsForProfile.js";

const BUILTIN_BROWSER_TTS_ID = "builtin.browserTts";

/** Mirrors @cline/shared BUILTIN_PROVIDER_MANIFESTS without value-importing shared. */
const BUILTIN_PROVIDER_MANIFESTS: readonly DriveProviderManifest[] = [
	{
		schemaVersion: 1,
		id: "builtin.webSpeech",
		slot: "stt",
		title: "Web Speech (browser)",
		origin: "builtin",
		egress: "platform-cloud",
		backend: { kind: "webSpeech" },
		defaultConfig: {},
		configSchemaId: "builtin.webSpeech.v1",
	},
	{
		schemaVersion: 1,
		id: "builtin.localWorkerStt",
		slot: "stt",
		title: "Local STT worker",
		origin: "builtin",
		egress: "loopback-only",
		backend: { kind: "local-worker", engine: "whisper-cpp" },
		defaultConfig: {},
		configSchemaId: "builtin.localWorkerStt.v1",
	},
	{
		schemaVersion: 1,
		id: BUILTIN_BROWSER_TTS_ID,
		slot: "tts",
		title: "Browser speechSynthesis",
		origin: "builtin",
		egress: "loopback-only",
		backend: { kind: "browser-speechSynthesis" },
		defaultConfig: {},
		configSchemaId: "builtin.browserTts.v1",
	},
];

export function defaultFacetValuesFromProfile(
	profile: DriveFacetValues["runtime.profile"],
): DriveFacetValues {
	const seed = seedFacetsForProfile(profile);
	return {
		...seed,
		"tts.enabled": false,
		"tts.maxSpokenSentences": 3,
		"captions.enabled": true,
		"drive.defaults.pairAgent": { kind: "builtin", id: "pair_partner" },
	};
}

export function resolveTopologyFromFacets(input: {
	facets: DriveFacetValues;
	llm: ResolvedLlmEgress;
	registry?: readonly DriveProviderManifest[];
}):
	| { ok: true; topology: RuntimeTopology }
	| { ok: false; message: string } {
	const registry = input.registry ?? BUILTIN_PROVIDER_MANIFESTS;
	const sttManifest = registry.find(
		(manifest) =>
			manifest.id === input.facets["providers.sttId"] &&
			manifest.slot === "stt",
	);
	const ttsManifest = registry.find(
		(manifest) =>
			manifest.id === input.facets["providers.ttsId"] &&
			manifest.slot === "tts",
	);
	if (!sttManifest) {
		return {
			ok: false,
			message: `Unknown STT provider ${input.facets["providers.sttId"]}`,
		};
	}
	if (!ttsManifest) {
		return {
			ok: false,
			message: `Unknown TTS provider ${input.facets["providers.ttsId"]}`,
		};
	}

	const stt = sttManifest.backend as SttBackend;
	const tts = ttsManifest.backend as TtsBackend;

	const topology: RuntimeTopology = {
		profile: input.facets["runtime.profile"],
		llm: input.llm,
		stt,
		tts,
		egressCeiling: input.facets["runtime.egressCeiling"],
	};

	const legal = assertTopologyLegal(topology);
	if (!legal.ok) {
		return { ok: false, message: legal.message };
	}

	const sttCompat = assertProviderCompatible(sttManifest, topology);
	if (!sttCompat.ok) {
		return { ok: false, message: sttCompat.message };
	}
	const ttsCompat = assertProviderCompatible(ttsManifest, topology);
	if (!ttsCompat.ok) {
		return { ok: false, message: ttsCompat.message };
	}

	return { ok: true, topology };
}

export function assertFacetProviderSelection(input: {
	facets: DriveFacetValues;
	llm: ResolvedLlmEgress;
	registry?: readonly DriveProviderManifest[];
}): { ok: true } | { ok: false; message: string } {
	const resolved = resolveTopologyFromFacets(input);
	if (!resolved.ok) {
		return resolved;
	}
	return { ok: true };
}

export function cloudDefaultsWithAnthropic(): {
	facets: DriveFacetValues;
	llm: ResolvedLlmEgress;
} {
	return {
		facets: defaultFacetValuesFromProfile("cloud"),
		llm: { kind: "cloud", providerId: "anthropic" },
	};
}

export function localDefaultsWithOllama(): {
	facets: DriveFacetValues;
	llm: ResolvedLlmEgress;
} {
	return {
		facets: defaultFacetValuesFromProfile("local"),
		llm: {
			kind: "local",
			providerId: "ollama",
			baseUrlClass: "loopback",
		},
	};
}

export const DEFAULT_TTS_PROVIDER_ID = BUILTIN_BROWSER_TTS_ID;
