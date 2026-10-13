"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AskQuestionRequestItem } from "@/hooks/chat-session/types";
import { desktopClient } from "@/lib/desktop-client";
import { LOCAL_WORKSPACE_ENVIRONMENT_ID } from "@/lib/workspace-paths";

export type FactoryAttention = {
	taskId: string;
	questions: AskQuestionRequestItem[];
	needsAttention: boolean;
};

export function useFactoryAttention() {
	const [items, setItems] = useState<FactoryAttention[]>([]);
	const [error, setError] = useState<string | null>(null);
	const generation = useRef(0);
	const refresh = useCallback(async () => {
		const request = ++generation.current;
		try {
			const next =
				await desktopClient.invoke<FactoryAttention[]>("factory_attention");
			if (request === generation.current) {
				setItems(next);
				setError(null);
			}
		} catch (cause) {
			if (request === generation.current)
				setError(
					cause instanceof Error
						? cause.message
						: "Unable to load feature questions.",
				);
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
		const timer = window.setInterval(() => void refresh(), 15_000);
		return () => {
			generation.current++;
			window.clearInterval(timer);
			for (const stop of unsubscribe) stop();
		};
	}, [refresh]);
	const answer = useCallback(
		async (requestId: string, value: string) => {
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
		[refresh],
	);
	return { items, error, answer, refresh };
}
