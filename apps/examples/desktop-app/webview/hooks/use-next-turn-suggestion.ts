"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";

type Offering = {
	candidates: readonly string[];
	index: number;
};

export type NextTurnSuggestionOptions = {
	enabled: boolean;
	environmentId: string;
	sessionId?: string | null;
	workspaceRoot: string;
	busy: boolean;
	draft: string;
};

/** One ephemeral offering per idle transition; all other lifecycle is local. */
export function useNextTurnSuggestion({
	enabled,
	environmentId,
	sessionId,
	workspaceRoot,
	busy,
	draft,
}: NextTurnSuggestionOptions) {
	const [offering, setOffering] = useState<Offering | null>(null);
	const generationRef = useRef(0);
	const busyRef = useRef(busy);
	const draftRef = useRef(draft);
	busyRef.current = busy;
	draftRef.current = draft;

	const dismiss = useCallback(() => {
		generationRef.current += 1;
		setOffering(null);
	}, []);

	useEffect(() => {
		if (draft) dismiss();
	}, [draft, dismiss]);

	useEffect(() => {
		dismiss();
		if (!enabled || busy || !sessionId || draftRef.current) return;
		const generation = generationRef.current;
		void (async () => {
			try {
				const value = await desktopClient.invoke<unknown>(
					"next_turn_suggestions",
					{
						environmentId,
						workspacePath: workspaceRoot,
						sessionId,
					},
				);
				if (
					generation !== generationRef.current ||
					busyRef.current ||
					draftRef.current ||
					!Array.isArray(value)
				) {
					return;
				}
				const candidates = value.filter(
					(prompt): prompt is string =>
						typeof prompt === "string" && prompt.trim().length > 0,
				);
				if (candidates.length > 0) setOffering({ candidates, index: 0 });
			} catch {
				// Suggestions are optional; an unavailable plugin stays invisible.
			}
		})();
		return () => {
			generationRef.current += 1;
		};
	}, [busy, dismiss, enabled, environmentId, sessionId, workspaceRoot]);

	const cycle = useCallback(() => {
		setOffering((current) =>
			current
				? {
						...current,
						index: (current.index + 1) % current.candidates.length,
					}
				: current,
		);
	}, []);

	const prompt = offering?.candidates[offering.index];
	return {
		prompt,
		position: offering ? offering.index + 1 : undefined,
		count: offering?.candidates.length,
		cycle,
		dismiss,
	};
}
