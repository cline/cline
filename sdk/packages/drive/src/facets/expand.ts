/**
 * Pure RosterPack expansion + permission capping (DRV-ROSTER-PACK).
 * Shared contracts are type-only (drivecode-sdk boundary).
 */

import type {
	AgentProfile,
	PermissionPreset,
	RosterPack,
	RosterPackMemberRole,
} from "@cline/shared";

const PRESET_RANK: Record<PermissionPreset, number> = {
	readonly: 0,
	standard: 1,
	full: 2,
};

const PRESET_BY_RANK: PermissionPreset[] = ["readonly", "standard", "full"];

/** Effective preset is the min of parent ceiling and child intent. */
export function capPreset(
	parent: PermissionPreset,
	child: PermissionPreset,
): PermissionPreset {
	const rank = Math.min(PRESET_RANK[parent], PRESET_RANK[child]);
	return PRESET_BY_RANK[rank] ?? "readonly";
}

export type KnownAgent = {
	readonly name: string;
};

export type SeatProposal = {
	readonly profileId: string;
	readonly role: RosterPackMemberRole;
	readonly displayName: string;
	readonly effectivePreset: PermissionPreset;
	readonly override?: RosterPack["members"][number]["override"];
};

export type ExpandRosterPackResult = {
	readonly proposals: SeatProposal[];
	readonly missing: string[];
	readonly truncated: boolean;
};

function defaultPresetForRole(role: RosterPackMemberRole): PermissionPreset {
	return role === "pair_partner" ? "standard" : "readonly";
}

/**
 * Expand a pack into seat proposals. Missing profiles are reported, not fatal.
 * Members beyond `seatCap` are dropped with `truncated: true`.
 */
export function expandRosterPack(input: {
	pack: RosterPack;
	profiles: ReadonlyMap<string, AgentProfile>;
	/** Reserved for host-known agent gating; unused in MVP expand. */
	known?: readonly KnownAgent[];
	parentPreset: PermissionPreset;
	seatCap: number;
	presetForProfile?: (
		profileId: string,
		role: RosterPackMemberRole,
	) => PermissionPreset;
}): ExpandRosterPackResult {
	void input.known;
	const missing: string[] = [];
	const proposals: SeatProposal[] = [];

	for (const member of input.pack.members) {
		const profile = input.profiles.get(member.profileId);
		if (!profile) {
			missing.push(member.profileId);
			continue;
		}
		const childPreset =
			input.presetForProfile?.(member.profileId, member.role) ??
			defaultPresetForRole(member.role);
		proposals.push({
			profileId: member.profileId,
			role: member.role,
			displayName:
				member.override?.displayName?.trim() ||
				profile.displayName?.trim() ||
				profile.id,
			effectivePreset: capPreset(input.parentPreset, childPreset),
			override: member.override,
		});
	}

	const seatCap = Math.max(0, Math.floor(input.seatCap));
	if (proposals.length <= seatCap) {
		return { proposals, missing, truncated: false };
	}
	return {
		proposals: proposals.slice(0, seatCap),
		missing,
		truncated: true,
	};
}
