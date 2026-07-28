import type {
	DriveProviderManifest,
	DriveProviderSlot,
	RuntimeTopology,
} from "@cline/shared";
import {
	assertTopologyLegal,
	type TopologyReject,
} from "./assertTopologyLegal.js";
import { egressWithinCeiling } from "./egressHelpers.js";

export function assertProviderCompatible(
	manifest: DriveProviderManifest,
	topology: RuntimeTopology,
): TopologyReject {
	if (!egressWithinCeiling(manifest.egress, topology.egressCeiling)) {
		return {
			ok: false,
			code: "egress_exceeds_ceiling",
			message: `Provider ${manifest.id} egress ${manifest.egress} exceeds ceiling ${topology.egressCeiling}.`,
		};
	}

	const next: RuntimeTopology =
		manifest.slot === "stt"
			? {
					...topology,
					stt: manifest.backend as RuntimeTopology["stt"],
				}
			: {
					...topology,
					tts: manifest.backend as RuntimeTopology["tts"],
				};

	return assertTopologyLegal(next);
}

export function listProviders(
	registry: readonly DriveProviderManifest[],
	slot: DriveProviderSlot,
	topology: RuntimeTopology,
): readonly DriveProviderManifest[] {
	return registry.filter(
		(manifest) =>
			manifest.slot === slot &&
			assertProviderCompatible(manifest, topology).ok,
	);
}
