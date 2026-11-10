"use client";

import type { FactoryRunState } from "@cline/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AskQuestionRequestItem } from "@/hooks/chat-session/types";
import { desktopClient } from "@/lib/desktop-client";
import { LOCAL_WORKSPACE_ENVIRONMENT_ID } from "@/lib/workspace-paths";

export type FactoryAttention = {
	taskId: string;
	revision: number;
	runId?: string;
	questions: AskQuestionRequestItem[];
	needsAttention: boolean;
	outcome?: Pick<
		FactoryRunState,
		"phase" | "humanApproval" | "audit" | "usage" | "repairRound"
	> & {
		activeRoles: Array<"builder" | "reviewer" | "verifier">;
		followupPaused: boolean;
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
			"task.updated",
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
