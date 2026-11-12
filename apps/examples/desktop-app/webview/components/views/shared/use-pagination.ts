import { useState } from "react";
import { usePaginationScroll } from "./use-pagination-scroll";

/**
 * Page state for a list: restarts when `resetKey` changes, never points past
 * the last page, and keeps the scroll position while pages swap.
 */
export function usePagination({
	total,
	pageSize,
	resetKey = "",
	holdPage = false,
}: {
	total: number;
	pageSize: number;
	/** Identifies the result set; a different key starts again at page one. */
	resetKey?: string;
	/** Keep the requested page while the total is still loading. */
	holdPage?: boolean;
}) {
	const pageCount = Math.max(1, Math.ceil(total / pageSize));
	const [state, setState] = useState({ key: resetKey, page: 1 });
	const page = state.key === resetKey ? Math.min(state.page, pageCount) : 1;
	// Derived state is corrected while rendering, not in an effect, so a stale
	// page never paints.
	if (state.key !== resetKey || (!holdPage && state.page !== page)) {
		setState({ key: resetKey, page });
	}
	const { contentRef, onPageChange } = usePaginationScroll({
		page,
		resetKey: JSON.stringify([resetKey, total]),
		onPageChange: (page) => setState({ key: resetKey, page }),
	});
	return {
		page,
		pageCount,
		/** Index of the first item on the current page. */
		offset: (page - 1) * pageSize,
		contentRef,
		onPageChange,
	};
}
