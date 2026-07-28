import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	assertFacetProviderSelection,
	defaultFacetValuesFromProfile,
} from "@cline/drive";
import {
	parseDriveFacetValues,
	resolveDriveFacetsPath,
	type DriveFacetValues,
	type ResolvedLlmEgress,
} from "@cline/shared";

export function readDriveFacetsFile(
	configParent: string,
): DriveFacetValues | null {
	const path = resolveDriveFacetsPath(configParent);
	if (!existsSync(path)) {
		return null;
	}
	const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
	return parseDriveFacetValues(raw);
}

export function writeDriveFacetsFile(
	configParent: string,
	facets: DriveFacetValues,
): void {
	const path = resolveDriveFacetsPath(configParent);
	mkdirSync(dirname(path), { recursive: true });
	const tmp = join(dirname(path), `.facets.v1.${process.pid}.tmp.json`);
	writeFileSync(tmp, `${JSON.stringify(facets, null, 2)}\n`, "utf8");
	renameSync(tmp, path);
}

/**
 * Validate provider selection against topology, then atomically persist facets.
 */
export function setDriveFacets(input: {
	configParent: string;
	facets: DriveFacetValues;
	llm: ResolvedLlmEgress;
}):
	| {
			ok: true;
			facets: DriveFacetValues;
			/** Payload for hub CONFIG_SNAPSHOT broadcast (no secrets). */
			snapshot: {
				profile: DriveFacetValues["runtime.profile"];
				sttId: string;
				ttsId: string;
				egressCeiling: DriveFacetValues["runtime.egressCeiling"];
			};
	  }
	| { ok: false; message: string } {
	const check = assertFacetProviderSelection({
		facets: input.facets,
		llm: input.llm,
	});
	if (!check.ok) {
		return check;
	}
	writeDriveFacetsFile(input.configParent, input.facets);
	return {
		ok: true,
		facets: input.facets,
		snapshot: {
			profile: input.facets["runtime.profile"],
			sttId: input.facets["providers.sttId"],
			ttsId: input.facets["providers.ttsId"],
			egressCeiling: input.facets["runtime.egressCeiling"],
		},
	};
}

export function loadOrSeedDriveFacets(input: {
	configParent: string;
	profile?: DriveFacetValues["runtime.profile"];
}): DriveFacetValues {
	const existing = readDriveFacetsFile(input.configParent);
	if (existing) {
		return existing;
	}
	return defaultFacetValuesFromProfile(input.profile ?? "cloud");
}
