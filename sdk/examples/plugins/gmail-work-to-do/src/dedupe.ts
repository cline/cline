import type { GmailWorkState } from "./state";

export interface GmailMessageCandidate {
	id: string;
	internalDate: string;
}

function compareInternalDate(
	left: string | undefined,
	right: string | undefined,
): number {
	const a = Number(left ?? "0");
	const b = Number(right ?? "0");
	if (!Number.isFinite(a) || !Number.isFinite(b)) {
		return String(left ?? "").localeCompare(String(right ?? ""));
	}
	return a - b;
}

export function selectNewMessages<T extends GmailMessageCandidate>(
	messages: readonly T[],
	state: GmailWorkState,
): T[] {
	const boundaryIds = new Set(state.seenIdsAtMaxInternalDate);
	return messages
		.filter((message) => {
			const compared = compareInternalDate(
				message.internalDate,
				state.maxInternalDate,
			);
			if (!state.maxInternalDate || compared > 0) {
				return true;
			}
			if (compared < 0) {
				return false;
			}
			return !boundaryIds.has(message.id);
		})
		.sort((left, right) => {
			const byDate = compareInternalDate(left.internalDate, right.internalDate);
			return byDate !== 0 ? byDate : left.id.localeCompare(right.id);
		});
}

export function advanceStateForProcessedMessages(
	state: GmailWorkState,
	processed: readonly GmailMessageCandidate[],
): GmailWorkState {
	if (processed.length === 0) {
		return {
			maxInternalDate: state.maxInternalDate,
			seenIdsAtMaxInternalDate: [...state.seenIdsAtMaxInternalDate],
		};
	}

	let maxInternalDate = state.maxInternalDate;
	let seenAtBoundary = new Set(state.seenIdsAtMaxInternalDate);
	for (const message of processed) {
		const compared = compareInternalDate(message.internalDate, maxInternalDate);
		if (!maxInternalDate || compared > 0) {
			maxInternalDate = message.internalDate;
			seenAtBoundary = new Set([message.id]);
			continue;
		}
		if (compared === 0) {
			seenAtBoundary.add(message.id);
		}
	}

	return {
		maxInternalDate,
		seenIdsAtMaxInternalDate: [...seenAtBoundary].sort(),
	};
}
