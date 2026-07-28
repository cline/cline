import {
	cloudDefaultsWithAnthropic,
	defaultFacetValuesFromProfile,
	localDefaultsWithOllama,
	resolveTopologyFromFacets,
} from "@cline/drive";
import type {
	DeploymentProfile,
	DriveFacetValues,
	ResolvedLlmEgress,
	RuntimeTopology,
} from "@cline/shared";
import { speechInputModeForBackend } from "./speechInputModeForBackend";
import type { SpeechInputMode } from "./speechInputModeForBackend";

export type DriveVoiceUi = {
	profile: DeploymentProfile;
	facets: DriveFacetValues;
	settingsOpen: boolean;
};

export function createDefaultDriveVoiceUi(
	profile: DeploymentProfile = "cloud",
): DriveVoiceUi {
	return {
		profile,
		facets: defaultFacetValuesFromProfile(profile),
		settingsOpen: false,
	};
}

export function applyVoiceProfile(
	voice: DriveVoiceUi,
	profile: DeploymentProfile,
): DriveVoiceUi {
	return {
		...voice,
		profile,
		facets: defaultFacetValuesFromProfile(profile),
	};
}

export function applyVoiceFacetPatch(
	voice: DriveVoiceUi,
	patch: Partial<DriveFacetValues>,
): DriveVoiceUi {
	return {
		...voice,
		facets: { ...voice.facets, ...patch },
		profile: patch["runtime.profile"] ?? voice.profile,
	};
}

export function resolveLlmEgressForUi(input: {
	profile: DeploymentProfile;
	providerId: string;
}): ResolvedLlmEgress {
	if (input.profile === "local") {
		return {
			kind: "local",
			providerId: input.providerId || "ollama",
			baseUrlClass: "loopback",
		};
	}
	return {
		kind: "cloud",
		providerId: input.providerId || "anthropic",
	};
}

export function resolveDriveVoiceTopology(input: {
	voice: DriveVoiceUi;
	providerId: string;
}):
	| { ok: true; topology: RuntimeTopology; forceMode: SpeechInputMode }
	| { ok: false; message: string } {
	const llm = resolveLlmEgressForUi({
		profile: input.voice.profile,
		providerId: input.providerId,
	});
	const resolved = resolveTopologyFromFacets({
		facets: input.voice.facets,
		llm,
	});
	if (!resolved.ok) {
		return resolved;
	}
	return {
		ok: true,
		topology: resolved.topology,
		forceMode: speechInputModeForBackend(resolved.topology.stt),
	};
}

export function voiceDefaultsForSmoke(profile: "local" | "cloud"): {
	voice: DriveVoiceUi;
	llm: ResolvedLlmEgress;
} {
	if (profile === "local") {
		const { facets, llm } = localDefaultsWithOllama();
		return {
			voice: { profile: "local", facets, settingsOpen: false },
			llm,
		};
	}
	const { facets, llm } = cloudDefaultsWithAnthropic();
	return {
		voice: { profile: "cloud", facets, settingsOpen: false },
		llm,
	};
}
