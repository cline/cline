"use client";

import {
	type ComposerSuggestionsAction,
	type PluginUiInvokeOutcome,
	readPluginUiEnvelope,
} from "@cline/shared/browser";
import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { desktopClient } from "@/lib/desktop-client";
import { eventEnvironmentId } from "@/lib/session-identity";
import { exposedSuggestionMemory } from "./exposed-memory";
import type {
	LastSkip,
	SuggestionsDispatch,
	SuggestionsEnvelope,
	SuggestionsResult,
} from "./types";

const SLOT = "composer.suggestions";

const INVOKE_OUTCOMES: ReadonlySet<string> = new Set<PluginUiInvokeOutcome>([
	"ok",
	"refused",
	"rejected",
	"unavailable",
	"timeout",
]);

function readSuggestionsEnvelope(
	value: unknown,
): SuggestionsEnvelope | undefined {
	const envelope = readPluginUiEnvelope(value);
	return envelope?.slot === SLOT ? envelope : undefined;
}

function readInvokeResult(value: unknown): SuggestionsResult {
	const record =
		value && typeof value === "object"
			? (value as Record<string, unknown>)
			: {};
	const { outcome, reason, epoch } = record;
	if (typeof outcome !== "string" || !INVOKE_OUTCOMES.has(outcome)) {
		return { outcome: "unavailable" };
	}
	const state = readSuggestionsEnvelope(record.state);
	return {
		outcome: outcome as PluginUiInvokeOutcome,
		...(reason === "stale" || reason === "unsendable" ? { reason } : {}),
		...(state ? { state } : {}),
		...(typeof epoch === "number" && Number.isFinite(epoch) ? { epoch } : {}),
	};
}

export function useSlotBinding({
	enabled,
	environmentId,
	sessionId,
	busy,
	attachDue,
	attachDueFor,
	dispatch,
	setLastSkip,
}: {
	enabled: boolean;
	environmentId: string;
	sessionId: string | null;
	busy: boolean;
	attachDue: boolean;
	attachDueFor: number | undefined;
	dispatch: SuggestionsDispatch;
	setLastSkip: Dispatch<SetStateAction<LastSkip | undefined>>;
}) {
	const [connectedEpoch, setConnectedEpoch] = useState(0);

	const busyRef = useRef(busy);
	busyRef.current = busy;
	/**
	 * The session verbs go to; empty while unbound or disabled. An unmount
	 * leaves it set, so a Send the person already made still reaches the chat they left.
	 */
	const boundRef = useRef("");
	/** Bumped on every bind and unbind, so a reply to an earlier bind is never applied. */
	const generationRef = useRef(0);
	/** The due re-attach already sent (its epoch, or null without one); undefined while none is due. */
	const attachingForRef = useRef<number | null | undefined>(undefined);

	useEffect(
		() =>
			desktopClient.subscribeTransportState((state) => {
				if (state !== "connected") return;
				setConnectedEpoch((epoch) => epoch + 1);
			}),
		[],
	);

	const invokeFor = useCallback(
		async (
			targetSessionId: string,
			action: ComposerSuggestionsAction,
		): Promise<SuggestionsResult> => {
			try {
				return readInvokeResult(
					await desktopClient.invoke("plugin_ui_invoke", {
						environmentId,
						sessionId: targetSessionId,
						slot: SLOT,
						action,
					}),
				);
			} catch {
				return { outcome: "unavailable" };
			}
		},
		[environmentId],
	);

	/**
	 * Invokes on the bound session, or resolves undefined while unbound. The
	 * reply reaches the reducer only while that bind lasts; the caller always
	 * gets the plugin's verdict, so a refusal still stops a Send whose pane left.
	 */
	const invoke = useCallback(
		async (
			action: ComposerSuggestionsAction,
			{ applyReply = true }: { applyReply?: boolean } = {},
		): Promise<SuggestionsResult | undefined> => {
			const targetSessionId = boundRef.current;
			const generation = generationRef.current;
			if (!targetSessionId) return undefined;
			const result = await invokeFor(targetSessionId, action);
			if (applyReply && generation === generationRef.current) {
				dispatch({
					type: "reply",
					sessionId: targetSessionId,
					result,
					now: Date.now(),
				});
			}
			return result;
		},
		[dispatch, invokeFor],
	);

	const attach = useCallback(
		async (targetSessionId: string, generation: number) => {
			const result = await invokeFor(targetSessionId, {
				verb: "attach",
				surface: "desktop",
			});
			if (generation !== generationRef.current) return;
			dispatch({
				type: "reply",
				sessionId: targetSessionId,
				result,
				now: Date.now(),
			});
			dispatch({
				type: "attached",
				sessionId: targetSessionId,
				outcome: result.outcome,
				epoch: result.epoch,
			});
		},
		[dispatch, invokeFor],
	);

	const live = enabled && Boolean(sessionId) && connectedEpoch > 0;
	// biome-ignore lint/correctness/useExhaustiveDependencies: connectedEpoch rebinds on every transport reconnect
	useEffect(() => {
		generationRef.current += 1;
		const generation = generationRef.current;
		const boundSessionId = live && sessionId ? sessionId : "";
		boundRef.current = boundSessionId;
		attachingForRef.current = undefined;
		setLastSkip(undefined);
		dispatch({ type: "bind", sessionId: sessionId ?? "" });
		if (sessionId) {
			for (const revision of exposedSuggestionMemory.revisions(
				environmentId,
				sessionId,
			)) {
				dispatch({ type: "exposed", revision });
			}
		}
		if (!boundSessionId) return;
		void (async () => {
			let states: unknown;
			try {
				states = await desktopClient.invoke("plugin_ui_get", {
					environmentId,
					sessionId: boundSessionId,
				});
			} catch {
				states = [];
			}
			if (generation !== generationRef.current) return;
			for (const value of Array.isArray(states) ? states : []) {
				const envelope = readSuggestionsEnvelope(value);
				if (envelope) dispatch({ type: "state", envelope, now: Date.now() });
			}
			if (busyRef.current) dispatch({ type: "run_started" });
			await attach(boundSessionId, generation);
		})();
		return () => {
			generationRef.current += 1;
			void invokeFor(boundSessionId, { verb: "detach" });
		};
	}, [attach, connectedEpoch, environmentId, invokeFor, live, sessionId]);

	useEffect(() => {
		if (!enabled) return;
		return desktopClient.subscribe("plugin_ui_state", (payload) => {
			if (eventEnvironmentId(payload) !== environmentId) return;
			const record = payload as { sessionId?: unknown; envelope?: unknown };
			const boundSessionId = boundRef.current;
			if (!boundSessionId || record.sessionId !== boundSessionId) return;
			const envelope = readSuggestionsEnvelope(record.envelope);
			if (envelope) dispatch({ type: "state", envelope, now: Date.now() });
		});
	}, [dispatch, enabled, environmentId]);

	useEffect(() => {
		if (!attachDue) {
			attachingForRef.current = undefined;
			return;
		}
		const due = attachDueFor ?? null;
		const boundSessionId = boundRef.current;
		if (!boundSessionId || attachingForRef.current === due) return;
		attachingForRef.current = due;
		void attach(boundSessionId, generationRef.current);
	}, [attach, attachDue, attachDueFor]);

	return { invoke, boundRef };
}
