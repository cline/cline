import type {
	AddressSet,
	ParticipantAudioFlags,
	RoutePlan,
	SeatedAgentCard,
} from "@cline/shared";

export type RouteReject =
	| { ok: true }
	| { ok: false; code: string; message: string };

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/g)
		.filter((token) => token.length > 1);
}

function scoreAgent(utteranceTokens: string[], agent: SeatedAgentCard): {
	score: number;
	reasons: string[];
} {
	const reasons: string[] = [];
	let score = 0;
	const labels = [...agent.labels, ...agent.domains].map((value) =>
		value.toLowerCase(),
	);
	for (const token of utteranceTokens) {
		for (const label of labels) {
			if (label.includes(token) || token.includes(label)) {
				score += 1;
				reasons.push(`label:${label}`);
			}
		}
	}
	if (agent.role === "pair_partner") {
		score += 0.1;
		reasons.push("role:pair_partner");
	}
	return { score, reasons: [...new Set(reasons)] };
}

export function planRoute(input: {
	utterance: string;
	utteranceId: string;
	seated: readonly SeatedAgentCard[];
	mode: RoutePlan["mode"];
	threshold?: number;
	allowFractions?: boolean;
}): RoutePlan {
	const threshold = input.threshold ?? 0.5;
	const tokens = tokenize(input.utterance);
	if (input.seated.length === 0) {
		return {
			utteranceId: input.utteranceId,
			mode: input.mode,
			lowConfidence: true,
			slices: [
				{
					sliceId: `${input.utteranceId}:empty`,
					start: 0,
					end: input.utterance.length,
					text: input.utterance,
					addressSet: { mode: "everyone" },
					score: 0,
					reasons: ["no_seated_agents"],
				},
			],
		};
	}

	const ranked = input.seated
		.map((agent) => ({ agent, ...scoreAgent(tokens, agent) }))
		.sort((a, b) => b.score - a.score);

	const best = ranked[0];
	const partner = input.seated.find((agent) => agent.role === "pair_partner");
	const lowConfidence = !best || best.score < threshold;

	// Never silent-widen to everyone when agents are seated: fall back to pair
	// partner (or best available) and keep lowConfidence so UI can force suggest.
	const fallbackId =
		partner?.participantId ?? best?.agent.participantId ?? input.seated[0]!.participantId;
	const addressSet: AddressSet = {
		mode: "agents",
		agentIds: [
			lowConfidence ? fallbackId : best!.agent.participantId,
		],
	};

	void input.allowFractions;

	return {
		utteranceId: input.utteranceId,
		mode: input.mode,
		lowConfidence,
		slices: [
			{
				sliceId: `${input.utteranceId}:0`,
				start: 0,
				end: input.utterance.length,
				text: input.utterance,
				addressSet,
				score: best?.score ?? 0,
				reasons: lowConfidence
					? [
							...(best?.reasons ?? []),
							"low_confidence_fallback_partner",
						]
					: (best?.reasons ?? []),
			},
		],
	};
}

export function assertRouteLegal(
	plan: RoutePlan,
	seatedIds: ReadonlySet<string>,
): RouteReject {
	if (plan.slices.length === 0) {
		return {
			ok: false,
			code: "empty_plan",
			message: "RoutePlan must include at least one slice.",
		};
	}
	for (const slice of plan.slices) {
		if (slice.addressSet.mode === "agents") {
			if (slice.addressSet.agentIds.length === 0) {
				return {
					ok: false,
					code: "empty_address_set",
					message: "Agent addressSet must not be empty.",
				};
			}
			for (const id of slice.addressSet.agentIds) {
				if (!seatedIds.has(id)) {
					return {
						ok: false,
						code: "unknown_agent",
						message: `Addressed agent ${id} is not seated.`,
					};
				}
			}
		}
	}
	return { ok: true };
}

export function assertDeliveryAllowed(input: {
	senderId: string;
	receiverId: string;
	flags: readonly ParticipantAudioFlags[];
	channel: "room" | "a2a";
	/** When muted, still allow silent work paths — speak path uses requireSpeak. */
	requireSpeak: boolean;
}): RouteReject {
	const sender = input.flags.find(
		(flag) => flag.participantId === input.senderId,
	);
	const receiver = input.flags.find(
		(flag) => flag.participantId === input.receiverId,
	);
	if (input.requireSpeak && sender?.muted) {
		return {
			ok: false,
			code: "sender_muted",
			message: `Sender ${input.senderId} is muted.`,
		};
	}
	if (receiver?.deafened) {
		return {
			ok: false,
			code: "receiver_deafened",
			message: `Receiver ${input.receiverId} is deafened.`,
		};
	}
	void input.channel;
	return { ok: true };
}
