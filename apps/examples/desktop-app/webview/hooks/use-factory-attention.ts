"use client";

import type {
	FactoryDependencyState,
	FactoryPartsSummary,
	FactoryRunState,
} from "@cline/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AskQuestionRequestItem } from "@/hooks/chat-session/types";
import { desktopClient } from "@/lib/desktop-client";
import { LOCAL_WORKSPACE_ENVIRONMENT_ID } from "@/lib/workspace-paths";

export type FactoryActiveSession = {
	sessionId: string;
	role: "builder" | "reviewer" | "verifier";
	/** ISO time the attempt started. */
	startedAt: string;
	/** A repository stage's name, when the session runs one. */
	stage?: string;
};

export type FactoryAttention = {
	taskId: string;
	revision: number;
	runId?: string;
	questions: AskQuestionRequestItem[];
	needsAttention: boolean;
	/** Factory filed this card for a pattern reviewers found in several cards. */
	ruleCard?: boolean;
	/** A split's parent: its parts' progress. */
	parts?: FactoryPartsSummary;
	/** A split's part that cannot start yet: what it waits for. */
	dependency?: FactoryDependencyState;
	outcome?: Pick<
		FactoryRunState,
		| "phase"
		| "humanApproval"
		| "audit"
		| "usage"
		| "repairRound"
		| "humanReview"
		| "pullRequestUrl"
		| "unresolvedFindings"
		| "pullRequestOutcome"
		| "error"
	> & {
		/** The verification setup's dry run, without its log. */
		verificationProfile?: Omit<
			NonNullable<FactoryRunState["verificationProfile"]>,
			"detail"
		>;
		activeRoles: Array<"builder" | "reviewer" | "verifier">;
		/** Role sessions with a running attempt, oldest first. */
		activeSessions: FactoryActiveSession[];
		followupPaused: boolean;
		/** Factory marked the draft PR ready for review. */
		pullRequestReady?: boolean;
	};
};

export function useFactoryAttention() {
	const [items, setItems] = useState<FactoryAttention[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [hasLoaded, setHasLoaded] = useState(false);
	const [transportReady, setTransportReady] = useState(false);
	const [isLoading, setIsLoading] = useState(true);
	const generation = useRef(0);
	const refresh = useCallback(async () => {
		const request = ++generation.current;
		setIsLoading(true);
		try {
			const next =
				await desktopClient.invoke<FactoryAttention[]>("factory_attention");
			if (request === generation.current) {
				setItems(next);
				setHasLoaded(true);
				setError(null);
			}
		} catch (cause) {
			if (request === generation.current)
				setError(
					cause instanceof Error
						? cause.message
						: "Unable to load feature questions.",
				);
		} finally {
			if (request === generation.current) setIsLoading(false);
		}
	}, []);
	useEffect(() => {
		void refresh();
		const unsubscribe = [
			"ask_question_requested",
			"ask_question_answered",
			"ask_question_cancelled",
			// A part created or deleted changes its parent's numbers.
			"task.created",
			"task.updated",
			"task.deleted",
			"task.run.started",
			"task.run.completed",
			"task.run.failed",
		].map((event) => desktopClient.subscribe(event, () => void refresh()));
		let reconnecting = false;
		const unsubscribeTransport = desktopClient.subscribeTransportState(
			(state) => {
				setTransportReady(state === "connected");
				if (state === "reconnecting" || state === "unavailable") {
					reconnecting = true;
					generation.current++;
					setHasLoaded(false);
					setIsLoading(false);
				}
				if (state === "connected" && reconnecting) {
					reconnecting = false;
					void refresh();
				}
			},
		);

		const timer = window.setInterval(() => void refresh(), 15_000);
		return () => {
			generation.current++;
			window.clearInterval(timer);
			unsubscribeTransport();
			for (const stop of unsubscribe) stop();
		};
	}, [refresh]);
	const answer = useCallback(
		async (requestId: string, value: string) => {
			if (requestId.startsWith("factory_question_")) {
				const task = items.find((item) =>
					item.questions.some((question) => question.requestId === requestId),
				);
				if (!task)
					throw new Error("This feature question is no longer available.");
				await desktopClient.invoke("task.factory.answer", {
					taskId: task.taskId,
					questionId: requestId,
					answer: value,
					allWorkspaces: true,
				});
			} else
				await desktopClient.invoke("respond_ask_question", {
					environmentId: LOCAL_WORKSPACE_ENVIRONMENT_ID,
					requestId,
					answer: value,
				});
			generation.current++;
			setItems((current) =>
				current.map((item) => ({
					...item,
					questions: item.questions.filter(
						(question) => question.requestId !== requestId,
					),
				})),
			);
			await refresh();
		},
		[refresh, items],
	);
	return {
		items,
		error,
		hasLoaded,
		isLoading,
		transportReady,
		answer,
		refresh,
	};
}
