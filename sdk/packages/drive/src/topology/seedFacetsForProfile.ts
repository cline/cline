import type { DeploymentProfile } from "@cline/shared";
import { defaultEgressCeiling } from "./egressHelpers.js";

/** Mirrors @cline/shared builtin ids — value import banned by boundary. */
const BUILTIN_BROWSER_TTS_ID = "builtin.browserTts";
const BUILTIN_LOCAL_WORKER_STT_ID = "builtin.localWorkerStt";
const BUILTIN_WEB_SPEECH_STT_ID = "builtin.webSpeech";

/** Partial facet values seeded when the user picks a runtime profile. */
export interface ProfileFacetSeed {
	readonly "runtime.profile": DeploymentProfile;
	readonly "runtime.egressCeiling": ReturnType<typeof defaultEgressCeiling>;
	readonly "providers.sttId": string;
	readonly "providers.ttsId": string;
	readonly "providers.sttConfig": Record<string, unknown>;
	readonly "providers.ttsConfig": Record<string, unknown>;
}

export function seedFacetsForProfile(
	profile: DeploymentProfile,
): ProfileFacetSeed {
	const egressCeiling = defaultEgressCeiling(profile);
	switch (profile) {
		case "local":
			return {
				"runtime.profile": "local",
				"runtime.egressCeiling": egressCeiling,
				"providers.sttId": BUILTIN_LOCAL_WORKER_STT_ID,
				"providers.ttsId": BUILTIN_BROWSER_TTS_ID,
				"providers.sttConfig": {
					baseUrl: "http://127.0.0.1:8080/v1",
					model: "whisper-1",
				},
				"providers.ttsConfig": {},
			};
		case "cloud":
			return {
				"runtime.profile": "cloud",
				"runtime.egressCeiling": egressCeiling,
				"providers.sttId": BUILTIN_WEB_SPEECH_STT_ID,
				"providers.ttsId": BUILTIN_BROWSER_TTS_ID,
				"providers.sttConfig": {},
				"providers.ttsConfig": {},
			};
		case "hybrid":
			return {
				"runtime.profile": "hybrid",
				"runtime.egressCeiling": egressCeiling,
				"providers.sttId": BUILTIN_LOCAL_WORKER_STT_ID,
				"providers.ttsId": BUILTIN_BROWSER_TTS_ID,
				"providers.sttConfig": {
					baseUrl: "http://127.0.0.1:8080/v1",
					model: "whisper-1",
				},
				"providers.ttsConfig": {},
			};
		default: {
			const _exhaustive: never = profile;
			return _exhaustive;
		}
	}
}
