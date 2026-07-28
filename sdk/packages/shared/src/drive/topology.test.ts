import { describe, expect, it } from "vitest";
import {
	defaultEgressCeiling,
	egressWithinCeiling,
	parseRuntimeTopology,
	sttBackendEgress,
	sttBackendsEqual,
	topologiesEqual,
	topologyCacheKey,
	ttsBackendsEqual,
} from "./topology";

describe("parseRuntimeTopology", () => {
	it("parses a legal local topology", () => {
		const topology = parseRuntimeTopology({
			profile: "local",
			llm: {
				kind: "local",
				providerId: "ollama",
				baseUrlClass: "loopback",
			},
			stt: { kind: "local-worker", engine: "whisper-cpp" },
			tts: { kind: "browser-speechSynthesis" },
			egressCeiling: "loopback-only",
		});
		expect(topology.profile).toBe("local");
	});

	it("rejects unknown profile", () => {
		expect(() =>
			parseRuntimeTopology({
				profile: "airgap",
				llm: { kind: "cloud", providerId: "anthropic" },
				stt: { kind: "webSpeech" },
				tts: { kind: "browser-speechSynthesis" },
				egressCeiling: "loopback-only",
			}),
		).toThrow();
	});
});

describe("egress helpers", () => {
	it("maps webSpeech to platform-cloud", () => {
		expect(sttBackendEgress({ kind: "webSpeech" })).toBe("platform-cloud");
	});

	it("seeds ceiling from profile", () => {
		expect(defaultEgressCeiling("local")).toBe("loopback-only");
		expect(defaultEgressCeiling("cloud")).toBe("platform-cloud");
	});

	it("allows loopback under declared-providers ceiling", () => {
		expect(egressWithinCeiling("loopback-only", "declared-providers")).toBe(
			true,
		);
		expect(egressWithinCeiling("platform-cloud", "loopback-only")).toBe(false);
	});
});

describe("backend / topology equality", () => {
	it("compares stt backends by kind and engine", () => {
		expect(
			sttBackendsEqual(
				{ kind: "local-worker", engine: "whisper-cpp" },
				{ kind: "local-worker", engine: "whisper-cpp" },
			),
		).toBe(true);
		expect(
			sttBackendsEqual(
				{ kind: "local-worker", engine: "whisper-cpp" },
				{ kind: "local-worker", engine: "faster-whisper" },
			),
		).toBe(false);
		expect(sttBackendsEqual({ kind: "webSpeech" }, { kind: "webSpeech" })).toBe(
			true,
		);
	});

	it("compares tts backends without stringify", () => {
		expect(
			ttsBackendsEqual(
				{ kind: "browser-speechSynthesis" },
				{ kind: "browser-speechSynthesis" },
			),
		).toBe(true);
		expect(
			ttsBackendsEqual(
				{ kind: "browser-speechSynthesis" },
				{ kind: "local-worker", engine: "piper" },
			),
		).toBe(false);
	});

	it("builds stable topology cache keys", () => {
		const topology = parseRuntimeTopology({
			profile: "local",
			llm: {
				kind: "local",
				providerId: "ollama",
				baseUrlClass: "loopback",
			},
			stt: { kind: "local-worker", engine: "whisper-cpp" },
			tts: { kind: "browser-speechSynthesis" },
			egressCeiling: "loopback-only",
		});
		expect(topologyCacheKey(topology)).toBe(
			"local|loopback-only|local:ollama:loopback|local-worker:whisper-cpp|browser-speechSynthesis",
		);
		expect(topologiesEqual(topology, topology)).toBe(true);
	});
});
