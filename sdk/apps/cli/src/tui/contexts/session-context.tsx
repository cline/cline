import type { AgentMode } from "@cline/core";
import type React from "react";
import {
	createContext,
	useCallback,
	useContext,
	useRef,
	useState,
} from "react";
import { getCliCompactionMode } from "../../utils/compaction-mode";
import type { CliCompactionMode } from "../../utils/types";
import type { ChatEntry, InlineStream, TuiProps } from "../types";
import { MAX_BUFFERED_LINES } from "../types";

interface SessionContextValue {
	entries: ChatEntry[];
	isRunning: boolean;
	isStreaming: boolean;
	abortRequested: boolean;
	hasSubmitted: boolean;
	uiMode: AgentMode;
	autoApproveAll: boolean;
	compactionMode: CliCompactionMode;
	lastTotalTokens: number;
	lastTotalCost: number;
	isExitRequested: boolean;

	appendEntry: (entry: ChatEntry) => void;
	updateLastEntry: (updater: (prev: ChatEntry) => ChatEntry) => void;
	updateEntry: (updater: (entry: ChatEntry) => ChatEntry) => void;
	closeInlineStream: () => void;
	activeInlineStreamRef: React.MutableRefObject<InlineStream>;

	setIsRunning: (v: boolean) => void;
	setIsStreaming: (v: boolean) => void;
	setAbortRequested: (v: boolean) => void;
	setHasSubmitted: (v: boolean) => void;
	setLastTotalTokens: (v: number) => void;
	setLastTotalCost: (v: number) => void;
	addUsageDelta: (usage: {
		inputTokens?: number;
		outputTokens?: number;
		cost?: number;
	}) => void;
	setUiMode: (mode: AgentMode) => void;
	toggleMode: () => void;
	toggleAutoApprove: () => void;
	setCompactionMode: (mode: CliCompactionMode) => void;
	requestExit: () => void;
	clearEntries: () => void;
	replaceEntries: (entries: ChatEntry[]) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
	const ctx = useContext(SessionContext);
	if (!ctx) throw new Error("useSession must be within SessionProvider");
	return ctx;
}

export function SessionProvider(props: {
	config: TuiProps["config"];
	initialEntries?: ChatEntry[];
	initialUsage?: {
		totalTokens: number;
		totalCost: number;
	};
	onRunningChange: TuiProps["onRunningChange"];
	onAutoApproveChange: TuiProps["onAutoApproveChange"];
	onCompactionModeChange: TuiProps["onCompactionModeChange"];
	onExit: TuiProps["onExit"];
	children: React.ReactNode;
}) {
	const {
		config,
		initialEntries,
		initialUsage,
		onRunningChange,
		onAutoApproveChange,
		onCompactionModeChange,
		onExit,
	} = props;

	const [entries, setEntries] = useState<ChatEntry[]>(() =>
		initialEntries && initialEntries.length > MAX_BUFFERED_LINES
			? initialEntries.slice(initialEntries.length - MAX_BUFFERED_LINES)
			: (initialEntries ?? []),
	);
	const [isRunning, _setIsRunning] = useState(false);
	const [isStreaming, setIsStreaming] = useState(false);
	const [abortRequested, setAbortRequested] = useState(false);
	const [hasSubmitted, setHasSubmitted] = useState(
		(initialEntries?.length ?? 0) > 0,
	);
	const [uiMode, setUiMode] = useState<AgentMode>(
		config.mode === "plan" ? "plan" : "act",
	);
	const [autoApproveAll, _setAutoApproveAll] = useState(
		config.toolPolicies["*"]?.autoApprove !== false,
	);
	const [compactionMode, _setCompactionMode] = useState<CliCompactionMode>(() =>
		getCliCompactionMode(config),
	);
	const [lastTotalTokens, setLastTotalTokens] = useState(
		() => initialUsage?.totalTokens ?? 0,
	);
	const [lastTotalCost, setLastTotalCost] = useState(
		() => initialUsage?.totalCost ?? 0,
	);
	const [isExitRequested, setIsExitRequested] = useState(false);

	const activeInlineStreamRef = useRef<InlineStream>(undefined);

	const setIsRunning = useCallback(
		(v: boolean) => {
			_setIsRunning(v);
			setAbortRequested(false);
			onRunningChange(v);
		},
		[onRunningChange],
	);

	const appendEntry = useCallback((entry: ChatEntry) => {
		setEntries((prev) => {
			const next = [...prev, entry];
			return next.length <= MAX_BUFFERED_LINES
				? next
				: next.slice(next.length - MAX_BUFFERED_LINES);
		});
	}, []);

	const updateLastEntry = useCallback(
		(updater: (prev: ChatEntry) => ChatEntry) => {
			setEntries((prev) => {
				if (prev.length === 0) return prev;
				const next = [...prev];
				next[next.length - 1] = updater(next[next.length - 1] as ChatEntry);
				return next;
			});
		},
		[],
	);

	const updateEntry = useCallback(
		(updater: (entry: ChatEntry) => ChatEntry) => {
			setEntries((prev) => {
				let changed = false;
				const next = prev.map((entry) => {
					const updated = updater(entry);
					if (updated !== entry) changed = true;
					return updated;
				});
				return changed ? next : prev;
			});
		},
		[],
	);

	const closeInlineStream = useCallback(() => {
		activeInlineStreamRef.current = undefined;
		setEntries((prev) => {
			if (prev.length === 0) return prev;
			const last = prev[prev.length - 1];
			if (
				last &&
				(last.kind === "assistant_text" ||
					last.kind === "reasoning" ||
					last.kind === "tool_call") &&
				last.streaming
			) {
				const next = [...prev];
				next[next.length - 1] = { ...last, streaming: false } as ChatEntry;
				return next;
			}
			return prev;
		});
	}, []);

	const toggleMode = useCallback(() => {
		setUiMode((m) => (m === "act" ? "plan" : "act"));
	}, []);

	const toggleAutoApprove = useCallback(() => {
		_setAutoApproveAll((prev) => {
			const next = !prev;
			onAutoApproveChange(next);
			return next;
		});
	}, [onAutoApproveChange]);

	const setCompactionMode = useCallback(
		(mode: CliCompactionMode) => {
			_setCompactionMode(mode);
			void onCompactionModeChange(mode);
		},
		[onCompactionModeChange],
	);

	const requestExit = useCallback(() => {
		setIsExitRequested(true);
		setTimeout(() => onExit(), 0);
	}, [onExit]);

	const clearEntries = useCallback(() => {
		setEntries([]);
		setLastTotalTokens(0);
		setLastTotalCost(0);
	}, []);

	const addUsageDelta = useCallback(
		(usage: { inputTokens?: number; outputTokens?: number; cost?: number }) => {
			const tokenDelta =
				Math.max(0, usage.inputTokens ?? 0) +
				Math.max(0, usage.outputTokens ?? 0);
			if (tokenDelta > 0) {
				setLastTotalTokens((prev) => prev + tokenDelta);
			}
			const costDelta = usage.cost;
			if (
				typeof costDelta === "number" &&
				Number.isFinite(costDelta) &&
				costDelta > 0
			) {
				setLastTotalCost((prev) => prev + costDelta);
			}
		},
		[],
	);

	const replaceEntries = useCallback((nextEntries: ChatEntry[]) => {
		setEntries(
			nextEntries.length > MAX_BUFFERED_LINES
				? nextEntries.slice(nextEntries.length - MAX_BUFFERED_LINES)
				: nextEntries,
		);
	}, []);

	const value: SessionContextValue = {
		entries,
		isRunning,
		isStreaming,
		abortRequested,
		hasSubmitted,
		uiMode,
		autoApproveAll,
		compactionMode,
		lastTotalTokens,
		lastTotalCost,
		isExitRequested,
		appendEntry,
		updateLastEntry,
		updateEntry,
		closeInlineStream,
		activeInlineStreamRef,
		setIsRunning,
		setIsStreaming,
		setAbortRequested,
		setHasSubmitted,
		setLastTotalTokens,
		setLastTotalCost,
		addUsageDelta,
		setUiMode,
		toggleMode,
		toggleAutoApprove,
		setCompactionMode,
		requestExit,
		clearEntries,
		replaceEntries,
	};

	return (
		<SessionContext.Provider value={value}>
			{props.children}
		</SessionContext.Provider>
	);
}
