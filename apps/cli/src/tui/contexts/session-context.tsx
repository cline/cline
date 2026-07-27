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
	isTeamActive: boolean;
	teamRunCount: number;

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
	addUsageDelta: (usage: UsageDelta) => void;
	setUiMode: (mode: AgentMode) => void;
	toggleMode: () => void;
	toggleAutoApprove: () => void;
	setCompactionMode: (mode: CliCompactionMode) => void;
	requestExit: () => void;
	clearEntries: () => void;
	replaceEntries: (entries: ChatEntry[]) => void;
	setTeamActive: (active: boolean) => void;
}

type UsageDelta = {
	inputTokens?: number;
	outputTokens?: number;
	cost?: number;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
	const ctx = useContext(SessionContext);
	if (!ctx) throw new Error("useSession must be within SessionProvider");
	return ctx;
}

export function nextUsageTokenDisplay(
	previousTotalTokens: number,
	usage: UsageDelta,
): number {
	const inputTokens = Math.max(0, usage.inputTokens ?? 0);
	return inputTokens > 0 ? inputTokens : previousTotalTokens;
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
	const [uiMode, _setUiMode] = useState<AgentMode>(
		config.mode === "plan" ? "plan" : "act",
	);
	// Mirror for appendEntry: entries are appended from event-handler
	// callbacks that must see the mode at append time, not at closure time.
	const uiModeRef = useRef<AgentMode>(config.mode === "plan" ? "plan" : "act");
	const setUiMode = useCallback((mode: AgentMode) => {
		uiModeRef.current = mode;
		_setUiMode(mode);
	}, []);
	const initialAutoApproveAll = config.toolPolicies["*"]?.autoApprove !== false;
	const autoApproveAllRef = useRef(initialAutoApproveAll);
	const [autoApproveAll, _setAutoApproveAll] = useState(initialAutoApproveAll);
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
	const [isTeamActive, setIsTeamActive] = useState(false);
	const [teamRunCount, setTeamRunCount] = useState(0);

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
		const stamped = entry.mode ? entry : { ...entry, mode: uiModeRef.current };
		setEntries((prev) => {
			const next = [...prev, stamped];
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
		setUiMode(uiModeRef.current === "act" ? "plan" : "act");
	}, [setUiMode]);

	const toggleAutoApprove = useCallback(() => {
		const next = !autoApproveAllRef.current;
		autoApproveAllRef.current = next;
		onAutoApproveChange(next);
		_setAutoApproveAll(next);
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

	const addUsageDelta = useCallback((usage: UsageDelta) => {
		const nextTotalTokens = nextUsageTokenDisplay(0, usage);
		if (nextTotalTokens > 0) {
			setLastTotalTokens((prev) => nextUsageTokenDisplay(prev, usage));
		}
		const costDelta = usage.cost;
		if (
			typeof costDelta === "number" &&
			Number.isFinite(costDelta) &&
			costDelta > 0
		) {
			setLastTotalCost((prev) => prev + costDelta);
		}
	}, []);

	const replaceEntries = useCallback((nextEntries: ChatEntry[]) => {
		setEntries(
			nextEntries.length > MAX_BUFFERED_LINES
				? nextEntries.slice(nextEntries.length - MAX_BUFFERED_LINES)
				: nextEntries,
		);
	}, []);

	const setTeamActive = useCallback(
		(active: boolean) => {
			setIsTeamActive(active);
			if (!active) {
				setTeamRunCount(0);
			}
		},
		[],
	);

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
		isTeamActive,
		teamRunCount,
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
		setTeamActive,
	};

	return (
		<SessionContext.Provider value={value}>
			{props.children}
		</SessionContext.Provider>
	);
}
