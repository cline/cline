import type {
	AddressSet,
	Participant,
	RoutePlan,
	SeatedAgentCard,
} from "@cline/shared";
import { assertRouteLegal, planRoute } from "@cline/drive";
import { DRIVE_PARTICIPANT_PARTNER } from "./types";

export type RouterUiMode = "manual" | "suggest" | "auto";

export type RouteSuggestion = {
	plan: RoutePlan;
	displayName: string;
	participantId: string;
	score: number;
	reasons: string[];
	utterance: string;
};

/** Map Drive roster agents onto SeatedAgentCard for planRoute. */
export function seatedCardsFromParticipants(
	participants: readonly Participant[],
): SeatedAgentCard[] {
	return participants
		.filter((participant) => participant.kind === "agent")
		.map((participant) => ({
			participantId: participant.id,
			displayName: participant.displayName,
			role:
				participant.role === "partner" ||
				participant.id === DRIVE_PARTICIPANT_PARTNER
					? ("pair_partner" as const)
					: ("specialist" as const),
			labels: [participant.displayName],
			domains:
				participant.role === "specialist" ? [participant.displayName] : [],
		}));
}

/**
 * Suggest (or auto-apply) a route for a Drive utterance.
 * Returns null when manual or plan is illegal / everyone.
 */
export function suggestRouteForUtterance(input: {
	utterance: string;
	participants: readonly Participant[];
	mode: RouterUiMode;
}): {
	suggestion: RouteSuggestion | null;
	/** When mode is auto and confidence is high, address to apply immediately. */
	autoAddressSet: AddressSet | null;
} {
	if (input.mode === "manual") {
		return { suggestion: null, autoAddressSet: null };
	}

	let seated = seatedCardsFromParticipants(input.participants);
	if (seated.length === 0) {
		seated = [
			{
				participantId: DRIVE_PARTICIPANT_PARTNER,
				displayName: "Partner",
				role: "pair_partner",
				labels: ["partner"],
				domains: [],
			},
		];
	}

	const utteranceId = `utt_${Date.now()}`;
	const plan = planRoute({
		utterance: input.utterance,
		utteranceId,
		seated,
		mode: input.mode === "auto" ? "auto" : "suggest",
	});
	const seatedIds = new Set(seated.map((entry) => entry.participantId));
	const legal = assertRouteLegal(plan, seatedIds);
	if (!legal.ok) {
		return { suggestion: null, autoAddressSet: null };
	}

	const slice = plan.slices[0];
	if (!slice || slice.addressSet.mode !== "agents") {
		return { suggestion: null, autoAddressSet: null };
	}
	const participantId = slice.addressSet.agentIds[0]!;
	const card = seated.find((entry) => entry.participantId === participantId);
	const suggestion: RouteSuggestion = {
		plan,
		displayName: card?.displayName ?? participantId,
		participantId,
		score: slice.score,
		reasons: slice.reasons,
		utterance: input.utterance,
	};

	if (input.mode === "auto" && !plan.lowConfidence) {
		return { suggestion: null, autoAddressSet: slice.addressSet };
	}
	return { suggestion, autoAddressSet: null };
}
