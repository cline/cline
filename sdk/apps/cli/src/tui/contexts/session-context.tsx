import type { AgentMode } from "@clinebot/core";
import type React from "react";
import {
	createContext,
	useCallback,
	useContext,
	useRef,
	useState,
} from "react";
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
	setUiMode: (mode: AgentMode) => void;
	toggleMode: () => void;
	toggleAutoApprove: () => void;
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
	onExit: TuiProps["onExit"];
	children: React.ReactNode;
}) {
	const {
		config,
		initialEntries,
		initialUsage,
		onRunningChange,
		onAutoApproveChange,
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
	const [lastTotalTokens, setLastTotalTokens] = useState(
		() => initialUsage?.totalTokens ?? 0,
	);
	const [lastTotalCost, setLastTotalCost] = useState(
		() => initialUsage?.totalCost ?? 0,
	);
	const [isExitRequested, setIsExitRequested] = useState(false);

	const activeInlineStreamRef = useRef<InlineStream>(undefined);
	const onRunningChangeRef = useRef(onRunningChange);
	onRunningChangeRef.current = onRunningChange;
	const onAutoApproveChangeRef = useRef(onAutoApproveChange);
	onAutoApproveChangeRef.current = onAutoApproveChange;
	const onExitRef = useRef(onExit);
	onExitRef.current = onExit;

	const setIsRunning = useCallback((v: boolean) => {
		_setIsRunning(v);
		onRunningChangeRef.current(v);
	}, []);

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
			onAutoApproveChangeRef.current(next);
			return next;
		});
	}, []);

	const requestExit = useCallback(() => {
		setIsExitRequested(true);
		setTimeout(() => onExitRef.current(), 0);
	}, []);

	const clearEntries = useCallback(() => {
		setEntries([]);
		setLastTotalTokens(0);
		setLastTotalCost(0);
	}, []);

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
		setUiMode,
		toggleMode,
		toggleAutoApprove,
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
