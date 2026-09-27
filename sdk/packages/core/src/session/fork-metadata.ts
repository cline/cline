export function createForkSessionMetadata(input: {
	metadata?: Record<string, unknown> | null;
	forkedFromSessionId: string;
	forkedAt: string;
	source: string;
	beforeRunCount?: number;
}): Record<string, unknown> {
	const {
		handoff: _handoff,
		cloudHandoffScope: _scope,
		cloudHandoffIntent: _intent,
		cloudHandoffSeedDispatched: _seedDispatched,
		...metadata
	} = input.metadata ?? {};
	return {
		...metadata,
		fork: {
			forkedFromSessionId: input.forkedFromSessionId,
			forkedAt: input.forkedAt,
			source: input.source,
			...(input.beforeRunCount !== undefined
				? { beforeRunCount: input.beforeRunCount }
				: {}),
			...(metadata.checkpoint !== undefined
				? { checkpoints: metadata.checkpoint }
				: {}),
		},
	};
}
