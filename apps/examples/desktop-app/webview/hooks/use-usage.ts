"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";
import type { UsagePatternsReport } from "@/lib/usage-types";

/** A full scan walks every session store, so allow well beyond the default. */
const SCAN_TIMEOUT_MS = 120_000;

export interface UseUsagePatternsResult {
	report: UsagePatternsReport | null;
	error: string | null;
	loading: boolean;
	refreshing: boolean;
	refresh: () => void;
}

/**
 * Reads the local usage-pattern report for the selected window.
 *
 * `get_usage_patterns` serves a briefly cached report; `refresh: true` drops
 * that cache first, which is what the refresh button uses.
 */
export function useUsagePatterns(rangeDays: number): UseUsagePatternsResult {
	const [report, setReport] = useState<UsagePatternsReport | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	// Ignore a slow response that lands after a newer request.
	const requestRef = useRef(0);

	const load = useCallback(
		async (refresh: boolean) => {
			const requestId = ++requestRef.current;
			if (refresh) setRefreshing(true);
			try {
				const response = await desktopClient.invoke<UsagePatternsReport>(
					"get_usage_patterns",
					{ rangeDays, refresh },
					{ timeoutMs: SCAN_TIMEOUT_MS },
				);
				if (requestRef.current !== requestId) return;
				setReport(response);
				setError(null);
			} catch (caught) {
				if (requestRef.current !== requestId) return;
				setError(caught instanceof Error ? caught.message : String(caught));
			} finally {
				if (requestRef.current === requestId) {
					setLoading(false);
					setRefreshing(false);
				}
			}
		},
		[rangeDays],
	);

	useEffect(() => {
		setLoading(true);
		void load(false);
	}, [load]);

	const refresh = useCallback(() => {
		void load(true);
	}, [load]);

	return { report, error, loading, refreshing, refresh };
}
