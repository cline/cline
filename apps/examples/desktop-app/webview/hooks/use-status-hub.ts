import {
	type StatusPage,
	StatusPageSchema,
	type StatusQuery,
	type StatusSummary,
	StatusSummarySchema,
	type StatusUpdate,
} from "@cline/shared/browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";
import type { DesktopTransportState } from "@/lib/desktop-transport";

export type StatusHubTab = "board" | "changelog";

export function useStatusHub(tab: StatusHubTab, query: StatusQuery) {
	const [rows, setRows] = useState<StatusUpdate[]>([]);
	const [page, setPage] = useState<StatusPage | null>(null);
	const [summary, setSummary] = useState<StatusSummary | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [connection, setConnection] =
		useState<DesktopTransportState>("connecting");
	const [newUpdates, setNewUpdates] = useState(false);
	const [revision, setRevision] = useState(0);
	const request = useRef(0);
	const paged = useRef(false);
	const requestKey = JSON.stringify([query, revision]);
	const command = tab === "board" ? "status.board" : "status.query";
	const refresh = useCallback(() => setRevision((value) => value + 1), []);

	useEffect(() => {
		const id = ++request.current;
		paged.current = false;
		setLoading(true);
		setLoadingMore(false);
		setError(null);
		setNewUpdates(false);
		setRows([]);
		setPage(null);
		void Promise.all([
			desktopClient.invoke(command, JSON.parse(requestKey)[0]),
			desktopClient.invoke("status.summary"),
		])
			.then(([result, counts]) => {
				if (request.current !== id) return;
				const nextPage = StatusPageSchema.parse(result);
				const nextSummary = StatusSummarySchema.parse(counts);
				setRows(nextPage.updates);
				setPage(nextPage);
				setSummary(nextSummary);
			})
			.catch((failure) => {
				if (request.current === id)
					setError(
						failure instanceof Error
							? failure.message
							: "Unable to load Status Hub.",
					);
			})
			.finally(() => {
				if (request.current === id) setLoading(false);
			});
		return () => {
			++request.current;
		};
	}, [command, requestKey]);

	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const invalidate = () => {
			// Preserve a reader's position in history. A refresh returns to the top.
			if (paged.current) {
				setNewUpdates(true);
				return;
			}
			clearTimeout(timer);
			timer = setTimeout(refresh, 200);
		};
		const unsubscribe = desktopClient.subscribe("status.updated", invalidate);
		const unsubscribeTransport = desktopClient.subscribeTransportState(
			(state) => {
				setConnection(state);
				if (state === "connected") invalidate();
			},
		);
		return () => {
			clearTimeout(timer);
			unsubscribe();
			unsubscribeTransport();
		};
	}, [refresh]);

	const loadMore = async () => {
		if (loading || loadingMore || !page?.hasMore || page.nextCursor === null)
			return;
		const id = ++request.current;
		paged.current = true;
		setLoadingMore(true);
		setError(null);
		try {
			const result = StatusPageSchema.parse(
				await desktopClient.invoke(command, {
					...JSON.parse(requestKey)[0],
					cursor: page.nextCursor,
				}),
			);
			if (request.current !== id) return;
			setRows((current) => {
				const seen = new Set(current.map((row) => row.updateId));
				return [
					...current,
					...result.updates.filter((row) => !seen.has(row.updateId)),
				];
			});
			setPage(result);
		} catch (failure) {
			if (request.current === id)
				setError(
					failure instanceof Error
						? failure.message
						: "Unable to load more updates.",
				);
		} finally {
			if (request.current === id) setLoadingMore(false);
		}
	};

	return {
		connection,
		rows,
		page,
		summary,
		loading,
		loadingMore,
		error,
		newUpdates,
		refresh,
		loadMore,
	};
}
