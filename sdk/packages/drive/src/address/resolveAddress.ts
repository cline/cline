/**
 * Resolve AddressSet to seated participant ids (DRV-ADDRESS).
 * Empty resolution fails closed — never widens to everyone.
 */

import type { AddressSet, Participant, SeatSource } from "@cline/shared";

export type ResolveAddressInput = {
	addressSet: AddressSet;
	participants: readonly Participant[];
};

export type ResolveAddressResult =
	| { ok: true; participantIds: readonly string[] }
	| {
			ok: false;
			code: "empty_address" | "pack_not_addressable";
			message: string;
	  };

function hasPackSource(
	sources: readonly SeatSource[],
	packId: string,
): boolean {
	return sources.some(
		(source) => source.kind === "pack" && source.packId === packId,
	);
}

/**
 * Resolve who should receive the next send.
 * - everyone → all seated agent ids
 * - agents → listed ids ∩ seated agents (empty → fail)
 * - pack → seated agents carrying that pack seat source (empty → fail)
 */
export function resolveAddress(
	input: ResolveAddressInput,
): ResolveAddressResult {
	const agents = input.participants.filter((p) => p.kind === "agent");
	const seatedIds = new Set(agents.map((p) => p.id));

	switch (input.addressSet.mode) {
		case "everyone": {
			const participantIds = agents.map((p) => p.id);
			if (participantIds.length === 0) {
				return {
					ok: false,
					code: "empty_address",
					message: "No seated agents for everyone address",
				};
			}
			return { ok: true, participantIds };
		}
		case "agents": {
			const participantIds = input.addressSet.agentIds.filter((id) =>
				seatedIds.has(id),
			);
			if (participantIds.length === 0) {
				return {
					ok: false,
					code: "empty_address",
					message: "Addressed agents are not seated",
				};
			}
			return { ok: true, participantIds };
		}
		case "pack": {
			const packId = input.addressSet.packId;
			const participantIds = agents
				.filter((agent) => hasPackSource(agent.seatSources, packId))
				.map((agent) => agent.id);
			if (participantIds.length === 0) {
				return {
					ok: false,
					code: "empty_address",
					message: `No seated agents for pack ${packId}`,
				};
			}
			return { ok: true, participantIds };
		}
		default: {
			const _never: never = input.addressSet;
			return _never;
		}
	}
}
