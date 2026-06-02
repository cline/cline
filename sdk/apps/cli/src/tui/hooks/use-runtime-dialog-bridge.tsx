import type { AgentMode } from "@cline/core";
import type { ToolApprovalRequest, ToolApprovalResult } from "@cline/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RuntimeToolInteraction, TuiProps } from "../types";

type PendingRuntimeToolInteraction =
	| {
			id: number;
			kind: "tool_approval";
			request: ToolApprovalRequest;
			resolve: (result: ToolApprovalResult) => void;
	  }
	| {
			id: number;
			kind: "ask_question";
			question: string;
			options: string[];
			resolve: (answer: string) => void;
	  };

function toRuntimeToolInteraction(
	pending: PendingRuntimeToolInteraction,
): RuntimeToolInteraction {
	if (pending.kind === "tool_approval") {
		return {
			id: pending.id,
			kind: pending.kind,
			request: pending.request,
		};
	}
	return {
		id: pending.id,
		kind: pending.kind,
		question: pending.question,
		options: pending.options,
	};
}

function deniedToolResult(request: ToolApprovalRequest): ToolApprovalResult {
	return {
		approved: false,
		reason: `Tool "${request.toolName}" was denied by user`,
	};
}

function dismissPendingInteraction(pending: PendingRuntimeToolInteraction) {
	if (pending.kind === "tool_approval") {
		pending.resolve(deniedToolResult(pending.request));
		return;
	}
	pending.resolve("[User dismissed the question]");
}

export function useRuntimeDialogBridge(input: {
	setToolApprover: TuiProps["setToolApprover"];
	setAskQuestion: TuiProps["setAskQuestion"];
	setModeChangeNotifier: TuiProps["setModeChangeNotifier"];
	setUiMode: (mode: AgentMode) => void;
	refocusTextarea: () => void;
}) {
	const {
		setToolApprover,
		setAskQuestion,
		setModeChangeNotifier,
		setUiMode,
		refocusTextarea,
	} = input;
	const [interaction, setInteraction] = useState<RuntimeToolInteraction | null>(
		null,
	);
	const activeRef = useRef<PendingRuntimeToolInteraction | null>(null);
	const queueRef = useRef<PendingRuntimeToolInteraction[]>([]);
	const nextIdRef = useRef(1);

	const activate = useCallback((pending: PendingRuntimeToolInteraction) => {
		activeRef.current = pending;
		setInteraction(toRuntimeToolInteraction(pending));
	}, []);

	const enqueue = useCallback(
		(pending: PendingRuntimeToolInteraction) => {
			if (activeRef.current) {
				queueRef.current.push(pending);
				return;
			}
			activate(pending);
		},
		[activate],
	);

	const finishActive = useCallback(
		(id: number) => {
			if (activeRef.current?.id !== id) {
				return false;
			}
			const next = queueRef.current.shift() ?? null;
			if (next) {
				activate(next);
				return true;
			}
			activeRef.current = null;
			setInteraction(null);
			return false;
		},
		[activate],
	);

	const resolveToolApproval = useCallback(
		(id: number, approved: boolean) => {
			const pending = activeRef.current;
			if (!pending || pending.id !== id || pending.kind !== "tool_approval") {
				return;
			}
			pending.resolve(
				approved ? { approved: true } : deniedToolResult(pending.request),
			);
			const hasNext = finishActive(id);
			if (!hasNext) {
				refocusTextarea();
			}
		},
		[finishActive, refocusTextarea],
	);

	const resolveAskQuestion = useCallback(
		(id: number, answer: string | null) => {
			const pending = activeRef.current;
			if (!pending || pending.id !== id || pending.kind !== "ask_question") {
				return;
			}
			pending.resolve(
				answer === null ? "[User dismissed the question]" : answer,
			);
			const hasNext = finishActive(id);
			if (!hasNext) {
				refocusTextarea();
			}
		},
		[finishActive, refocusTextarea],
	);

	const dismissAll = useCallback(() => {
		if (activeRef.current) {
			dismissPendingInteraction(activeRef.current);
			activeRef.current = null;
		}
		for (const pending of queueRef.current) {
			dismissPendingInteraction(pending);
		}
		queueRef.current = [];
		setInteraction(null);
	}, []);

	useEffect(() => {
		setToolApprover(
			(request) =>
				new Promise<ToolApprovalResult>((resolve) => {
					enqueue({
						id: nextIdRef.current,
						kind: "tool_approval",
						request,
						resolve,
					});
					nextIdRef.current += 1;
				}),
		);
		setAskQuestion(
			(question, options) =>
				new Promise<string>((resolve) => {
					enqueue({
						id: nextIdRef.current,
						kind: "ask_question",
						question,
						options,
						resolve,
					});
					nextIdRef.current += 1;
				}),
		);
		setModeChangeNotifier((mode) => {
			setUiMode(mode);
		});
		return () => {
			setToolApprover(null);
			setAskQuestion(null);
			setModeChangeNotifier(null);
			dismissAll();
		};
	}, [
		dismissAll,
		enqueue,
		setAskQuestion,
		setModeChangeNotifier,
		setToolApprover,
		setUiMode,
	]);

	return {
		interaction,
		resolveToolApproval,
		resolveAskQuestion,
	};
}
