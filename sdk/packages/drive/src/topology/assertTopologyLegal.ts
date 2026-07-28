import type { RuntimeTopology } from "@cline/shared";
import {
	egressWithinCeiling,
	sttBackendEgress,
	ttsBackendEgress,
} from "./egressHelpers.js";

export type TopologyRejectCode =
	| "local_forbids_platform_cloud_stt"
	| "local_forbids_cloud_llm"
	| "local_forbids_cloud_tts"
	| "egress_exceeds_ceiling"
	| "backend_unknown";

export type TopologyReject =
	| { ok: true }
	| { ok: false; code: TopologyRejectCode; message: string };

export function assertTopologyLegal(
	topology: RuntimeTopology,
): TopologyReject {
	if (topology.profile === "local") {
		if (topology.llm.kind !== "local") {
			return {
				ok: false,
				code: "local_forbids_cloud_llm",
				message:
					"Local profile requires a loopback LLM provider (for example Ollama).",
			};
		}
		if (topology.stt.kind === "webSpeech") {
			return {
				ok: false,
				code: "local_forbids_platform_cloud_stt",
				message:
					"Local profile forbids Web Speech STT because audio may leave the machine.",
			};
		}
		if (topology.stt.kind === "cloud-api") {
			return {
				ok: false,
				code: "local_forbids_platform_cloud_stt",
				message: "Local profile forbids cloud STT APIs.",
			};
		}
		if (topology.tts.kind === "cloud-api") {
			return {
				ok: false,
				code: "local_forbids_cloud_tts",
				message: "Local profile forbids cloud TTS APIs.",
			};
		}
		if (topology.egressCeiling !== "loopback-only") {
			return {
				ok: false,
				code: "egress_exceeds_ceiling",
				message: "Local profile requires egressCeiling loopback-only.",
			};
		}
	}

	const sttEgress = sttBackendEgress(topology.stt);
	if (!egressWithinCeiling(sttEgress, topology.egressCeiling)) {
		return {
			ok: false,
			code: "egress_exceeds_ceiling",
			message: `STT egress ${sttEgress} exceeds ceiling ${topology.egressCeiling}.`,
		};
	}

	const ttsEgress = ttsBackendEgress(topology.tts);
	if (!egressWithinCeiling(ttsEgress, topology.egressCeiling)) {
		return {
			ok: false,
			code: "egress_exceeds_ceiling",
			message: `TTS egress ${ttsEgress} exceeds ceiling ${topology.egressCeiling}.`,
		};
	}

	if (
		topology.llm.kind === "cloud" &&
		!egressWithinCeiling("declared-providers", topology.egressCeiling)
	) {
		return {
			ok: false,
			code: "egress_exceeds_ceiling",
			message: `Cloud LLM exceeds ceiling ${topology.egressCeiling}.`,
		};
	}

	return { ok: true };
}
