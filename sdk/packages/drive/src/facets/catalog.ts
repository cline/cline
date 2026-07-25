/**
 * Phase 0 facet catalog — two durable entries plus live subMode for seed/live_wins.
 */

import type {
	AgentAppearance,
	DriveSubMode,
	FacetDefMeta,
	InkRef,
} from "@cline/shared";

export const DEFAULT_BODY_INK: InkRef = { kind: "token", token: "muted" };
export const DEFAULT_NAME_INK: InkRef = { kind: "palette", index: 0 };

export const DEFAULT_AGENT_APPEARANCE: AgentAppearance = {
	nameInk: DEFAULT_NAME_INK,
	bodyInk: DEFAULT_BODY_INK,
};

export const DRIVE_FACET_CATALOG = {
	"drive.defaults.subMode": {
		id: "drive.defaults.subMode",
		title: "Default Drive sub-mode",
		owner: "hub",
		scope: "user",
		lane: "durable",
		privacy: "public",
		conflict: "workspace_over_user",
		phase: 0,
		defaultValue: "plan",
	} satisfies FacetDefMeta<DriveSubMode>,

	"agent.appearance": {
		id: "agent.appearance",
		title: "Agent appearance",
		owner: "hub",
		scope: "workspace",
		lane: "durable",
		privacy: "public",
		conflict: "workspace_over_user",
		phase: 1,
		defaultValue: DEFAULT_AGENT_APPEARANCE,
	} satisfies FacetDefMeta<AgentAppearance>,

	/**
	 * Live room sub-mode. Seeded from drive.defaults.subMode at room create;
	 * disk reload must never overwrite (live_wins).
	 */
	"room.live.subMode": {
		id: "room.live.subMode",
		title: "Live room sub-mode",
		owner: "hub",
		scope: "room",
		lane: "live",
		privacy: "public",
		conflict: "live_wins",
		phase: 0,
		defaultValue: "plan",
	} satisfies FacetDefMeta<DriveSubMode>,
} as const;

export type DriveFacetCatalog = typeof DRIVE_FACET_CATALOG;
export type DriveFacetKey = keyof DriveFacetCatalog;

export type DriveFacetValue<K extends DriveFacetKey> =
	DriveFacetCatalog[K]["defaultValue"];

export function listFacetDefs(filter?: {
	phase?: number;
	lane?: DriveFacetCatalog[DriveFacetKey]["lane"];
}): Array<DriveFacetCatalog[DriveFacetKey]> {
	return (Object.values(DRIVE_FACET_CATALOG) as Array<
		DriveFacetCatalog[DriveFacetKey]
	>).filter((def) => {
		if (filter?.phase !== undefined && def.phase > filter.phase) {
			return false;
		}
		if (filter?.lane !== undefined && def.lane !== filter.lane) {
			return false;
		}
		return true;
	});
}
