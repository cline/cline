import { describe, expect, it } from "vitest";
import {
	BUILTIN_PROVIDER_MANIFESTS,
	BUILTIN_WEB_SPEECH_STT_ID,
	type RuntimeTopology,
} from "@cline/shared";
import { assertTopologyLegal } from "./assertTopologyLegal.js";
import {
	assertProviderCompatible,
	listProviders,
} from "./assertProviderCompatible.js";
import {
	cloudDefaultsWithAnthropic,
	localDefaultsWithOllama,
	resolveTopologyFromFacets,
} from "./resolveTopologyFromFacets.js";
import { seedFacetsForProfile } from "./seedFacetsForProfile.js";

const localTopology: RuntimeTopology = {
	profile: "local",
	llm: {
		kind: "local",
		providerId: "ollama",
		baseUrlClass: "loopback",
	},
	stt: { kind: "local-worker", engine: "whisper-cpp" },
	tts: { kind: "browser-speechSynthesis" },
	egressCeiling: "loopback-only",
};

const cloudTopology: RuntimeTopology = {
	profile: "cloud",
	llm: { kind: "cloud", providerId: "anthropic" },
	stt: { kind: "webSpeech" },
	tts: { kind: "browser-speechSynthesis" },
	egressCeiling: "platform-cloud",
};

describe("assertTopologyLegal", () => {
	it("accepts local pack", () => {
		expect(assertTopologyLegal(localTopology)).toEqual({ ok: true });
	});

	it("rejects local + webSpeech", () => {
		const result = assertTopologyLegal({
			...localTopology,
			stt: { kind: "webSpeech" },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("local_forbids_platform_cloud_stt");
		}
	});

	it("rejects local + cloud llm", () => {
		const result = assertTopologyLegal({
			...localTopology,
			llm: { kind: "cloud", providerId: "anthropic" },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("local_forbids_cloud_llm");
		}
	});

	it("accepts cloud + webSpeech under platform-cloud ceiling", () => {
		expect(assertTopologyLegal(cloudTopology)).toEqual({ ok: true });
	});

	it("rejects cloud webSpeech under declared-providers ceiling", () => {
		const result = assertTopologyLegal({
			...cloudTopology,
			egressCeiling: "declared-providers",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("egress_exceeds_ceiling");
		}
	});
});

describe("seedFacetsForProfile", () => {
	it("seeds local away from webSpeech", () => {
		const seed = seedFacetsForProfile("local");
		expect(seed["providers.sttId"]).toBe("builtin.localWorkerStt");
		expect(seed["runtime.egressCeiling"]).toBe("loopback-only");
	});

	it("seeds cloud to webSpeech", () => {
		const seed = seedFacetsForProfile("cloud");
		expect(seed["providers.sttId"]).toBe(BUILTIN_WEB_SPEECH_STT_ID);
	});
});

describe("listProviders", () => {
	it("hides webSpeech under local topology", () => {
		const stt = listProviders(BUILTIN_PROVIDER_MANIFESTS, "stt", localTopology);
		expect(stt.map((entry) => entry.id)).not.toContain(
			BUILTIN_WEB_SPEECH_STT_ID,
		);
	});

	it("includes webSpeech when ceiling is platform-cloud", () => {
		const stt = listProviders(
			BUILTIN_PROVIDER_MANIFESTS,
			"stt",
			cloudTopology,
		);
		expect(stt.map((entry) => entry.id)).toContain(BUILTIN_WEB_SPEECH_STT_ID);
	});
});

describe("assertProviderCompatible", () => {
	it("rejects webSpeech manifest for local topology", () => {
		const manifest = BUILTIN_PROVIDER_MANIFESTS.find(
			(entry) => entry.id === BUILTIN_WEB_SPEECH_STT_ID,
		);
		expect(manifest).toBeDefined();
		if (!manifest) {
			return;
		}
		const result = assertProviderCompatible(manifest, localTopology);
		expect(result.ok).toBe(false);
	});
});

describe("resolveTopologyFromFacets", () => {
	it("accepts local defaults with ollama", () => {
		const { facets, llm } = localDefaultsWithOllama();
		const result = resolveTopologyFromFacets({ facets, llm });
		expect(result.ok).toBe(true);
	});

	it("accepts cloud defaults with anthropic", () => {
		const { facets, llm } = cloudDefaultsWithAnthropic();
		const result = resolveTopologyFromFacets({ facets, llm });
		expect(result.ok).toBe(true);
	});

	it("rejects local facets that select webSpeech", () => {
		const { facets, llm } = localDefaultsWithOllama();
		const result = resolveTopologyFromFacets({
			facets: {
				...facets,
				"providers.sttId": BUILTIN_WEB_SPEECH_STT_ID,
			},
			llm,
		});
		expect(result.ok).toBe(false);
	});
});
