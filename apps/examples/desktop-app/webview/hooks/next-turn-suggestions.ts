import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { desktopClient } from "@/lib/desktop-client";

export type NextTurnSuggestionState = {
	prompts: string[];
	index: number;
};

/**
 * Run ids this thread has accepted, oldest first. The last id is the latest.
 * `newerRunStarted` is set when a later run begins, before that run has an id
 * here. A late event for the previous id is then older than the run in flight.
 */
export type NextTurnThreadMemory = {
	acceptedRunIds: readonly string[];
	newerRunStarted: boolean;
};

export const EMPTY_NEXT_TURN_THREAD: NextTurnThreadMemory = {
	acceptedRunIds: [],
	newerRunStarted: false,
};

const IN_FLIGHT_STATUSES = new Set(["starting", "running", "stopping"]);

export function nextTurnRunInFlight(status: string): boolean {
	return IN_FLIGHT_STATUSES.has(status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function suggestionPrompts(payload: Record<string, unknown>): string[] {
	if (!Array.isArray(payload.suggestions)) return [];
	return payload.suggestions.flatMap((suggestion) => {
		if (!isRecord(suggestion)) return [];
		return typeof suggestion.prompt === "string" && suggestion.prompt.length > 0
			? [suggestion.prompt]
			: [];
	});
}

export function markNewerNextTurnRun(
	memory: NextTurnThreadMemory,
): NextTurnThreadMemory {
	if (memory.acceptedRunIds.length === 0 || memory.newerRunStarted) {
		return memory;
	}
	return { ...memory, newerRunStarted: true };
}

/**
 * Accept a suggestion event for this thread, or ignore it.
 *
 * The rules event is published before desktop status leaves "running", so the
 * caller hides the result while a run is in flight instead of discarding the
 * event. An event for a run id this thread has not accepted yet is the run
 * that just finished. An event for an older accepted id is ignored. After a
 * newer run starts, a late event for the previous id is ignored too.
 * A later event for the current id replaces the prompts and resets the index.
 */
export function acceptNextTurnSuggestions(input: {
	sessionId: string | null | undefined;
	draft: string;
	payload: unknown;
	memory: NextTurnThreadMemory;
}): { state: NextTurnSuggestionState; memory: NextTurnThreadMemory } | null {
	if (!input.sessionId || input.draft.trim() !== "") return null;
	if (!isRecord(input.payload)) return null;
	if (input.payload.sessionId !== input.sessionId) return null;
	const runId =
		typeof input.payload.runId === "string" ? input.payload.runId : "";
	if (runId.length === 0) return null;
	const prompts = suggestionPrompts(input.payload);
	if (prompts.length === 0) return null;

	const acceptedRunIds = input.memory.acceptedRunIds;
	const latestRunId = acceptedRunIds.at(-1);
	if (latestRunId !== undefined && runId !== latestRunId) {
		if (acceptedRunIds.includes(runId)) return null;
	} else if (input.memory.newerRunStarted && runId === latestRunId) {
		return null;
	}

	return {
		state: { prompts, index: 0 },
		memory: {
			acceptedRunIds:
				runId === latestRunId ? acceptedRunIds : [...acceptedRunIds, runId],
			newerRunStarted: false,
		},
	};
}

export function readNextTurnSuggestions(input: {
	sessionId: string | null | undefined;
	draft: string;
	payload: unknown;
}): NextTurnSuggestionState | null {
	return (
		acceptNextTurnSuggestions({
			...input,
			memory: EMPTY_NEXT_TURN_THREAD,
		})?.state ?? null
	);
}

/** Ghost text is absent while a run is in flight. The stored set stays put. */
export function visibleNextTurnSuggestions(
	state: NextTurnSuggestionState | undefined,
	runInFlight: boolean,
): NextTurnSuggestionState | undefined {
	if (runInFlight) return undefined;
	return state;
}

export function currentNextTurnPrompt(
	state: NextTurnSuggestionState | undefined,
): string | undefined {
	if (!state || state.prompts.length === 0) return undefined;
	return state.prompts[state.index % state.prompts.length];
}

export function cycleNextTurnSuggestions(
	state: NextTurnSuggestionState,
	direction: "next" | "previous" = "next",
): NextTurnSuggestionState {
	const offset = direction === "next" ? 1 : -1;
	return {
		...state,
		index: (state.index + offset + state.prompts.length) % state.prompts.length,
	};
}

/**
 * Ghost-text suggestions for one chat pane. The pane remounts per thread, so
 * only a session change, a new turn, or a run starting retires the stored set.
 */
export function useNextTurnSuggestions(input: {
	sessionId: string | null | undefined;
	status: string;
	turnEpoch: number;
	promptInputRef: RefObject<string>;
	setPromptInput: (value: string) => void;
}) {
	const { sessionId, turnEpoch, promptInputRef, setPromptInput } = input;
	const runInFlight = nextTurnRunInFlight(input.status);
	const [suggestions, setSuggestions] = useState<NextTurnSuggestionState>();
	const memoryRef = useRef(EMPTY_NEXT_TURN_THREAD);
	const [tracked, setTracked] = useState({ sessionId, turnEpoch, runInFlight });
	if (
		tracked.sessionId !== sessionId ||
		tracked.turnEpoch !== turnEpoch ||
		tracked.runInFlight !== runInFlight
	) {
		setTracked({ sessionId, turnEpoch, runInFlight });
		if (tracked.sessionId !== sessionId) {
			memoryRef.current = EMPTY_NEXT_TURN_THREAD;
			setSuggestions(undefined);
		} else if (tracked.turnEpoch !== turnEpoch || runInFlight) {
			memoryRef.current = markNewerNextTurnRun(memoryRef.current);
			setSuggestions(undefined);
		}
	}

	useEffect(() => {
		return desktopClient.subscribe("next_turn_suggestions", (payload) => {
			const accepted = acceptNextTurnSuggestions({
				sessionId,
				draft: promptInputRef.current,
				payload,
				memory: memoryRef.current,
			});
			if (!accepted) return;
			memoryRef.current = accepted.memory;
			setSuggestions(accepted.state);
		});
	}, [promptInputRef, sessionId]);

	const suggestion = currentNextTurnPrompt(
		visibleNextTurnSuggestions(suggestions, runInFlight),
	);
	const accept = useCallback(() => {
		if (!suggestion) return;
		setPromptInput(suggestion);
		setSuggestions(undefined);
	}, [suggestion, setPromptInput]);
	const navigate = useCallback((direction: "next" | "previous") => {
		setSuggestions((current) =>
			current ? cycleNextTurnSuggestions(current, direction) : current,
		);
	}, []);
	return { suggestion, accept, navigate };
}
