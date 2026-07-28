/**
 * Local copies of shared topology egress helpers.
 * Avoids @cline/shared value imports (import-boundary).
 */

type EgressClass = "loopback-only" | "declared-providers" | "platform-cloud";

type SttBackend =
	| { kind: "local-worker"; engine: string }
	| { kind: "webSpeech" }
	| { kind: "cloud-api"; engine: string };

type TtsBackend =
	| { kind: "browser-speechSynthesis" }
	| { kind: "local-worker"; engine: string }
	| { kind: "cloud-api"; engine: string };

export function sttBackendEgress(backend: SttBackend): EgressClass {
	switch (backend.kind) {
		case "local-worker":
			return "loopback-only";
		case "webSpeech":
			return "platform-cloud";
		case "cloud-api":
			return "declared-providers";
		default: {
			const _exhaustive: never = backend;
			return _exhaustive;
		}
	}
}

export function ttsBackendEgress(backend: TtsBackend): EgressClass {
	switch (backend.kind) {
		case "browser-speechSynthesis":
		case "local-worker":
			return "loopback-only";
		case "cloud-api":
			return "declared-providers";
		default: {
			const _exhaustive: never = backend;
			return _exhaustive;
		}
	}
}

function egressRank(egress: EgressClass): number {
	switch (egress) {
		case "loopback-only":
			return 0;
		case "declared-providers":
			return 1;
		case "platform-cloud":
			return 2;
		default: {
			const _exhaustive: never = egress;
			return _exhaustive;
		}
	}
}

export function egressWithinCeiling(
	required: EgressClass,
	ceiling: EgressClass,
): boolean {
	return egressRank(required) <= egressRank(ceiling);
}

export function defaultEgressCeiling(
	profile: "local" | "cloud" | "hybrid",
): EgressClass {
	switch (profile) {
		case "local":
			return "loopback-only";
		case "cloud":
			return "platform-cloud";
		case "hybrid":
			return "declared-providers";
		default: {
			const _exhaustive: never = profile;
			return _exhaustive;
		}
	}
}
