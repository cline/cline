"use client";

import { createContext, useContext, useMemo, useState } from "react";

/**
 * How the app shell keeps a page's open detail in Back/Forward history. The
 * detail is opaque to the shell and compared by identity.
 */
export type DetailNavigationHost = {
	detail: object | undefined;
	open: (detail: object) => void;
	/** Swap the open detail without adding a history step. */
	replace: (detail: object) => void;
	/** Return to the list. `forget` also drops the detail from history, e.g. once its item is deleted. */
	close: (detail: object, options?: { forget?: boolean }) => void;
};

const DetailNavigationContext = createContext<DetailNavigationHost | null>(
	null,
);

export const DetailNavigationProvider = DetailNavigationContext.Provider;

/**
 * A page's open detail page or editor. Inside the app it is a step in
 * Back/Forward history; rendered on its own, the page simply holds it.
 */
export function useDetailNavigation<T extends object>() {
	const host = useContext(DetailNavigationContext);
	const [localDetail, setLocalDetail] = useState<T | null>(null);
	return useMemo(() => {
		if (!host) {
			return {
				detail: localDetail,
				open: (detail: T) => setLocalDetail(detail),
				replace: (detail: T) => setLocalDetail(detail),
				close: (_options?: { forget?: boolean }) => setLocalDetail(null),
				/** Leave the detail for somewhere else on the page. */
				leaveFor: (navigate: () => void) => {
					setLocalDetail(null);
					navigate();
				},
			};
		}
		const detail = (host.detail as T | undefined) ?? null;
		return {
			detail,
			open: (next: T) => host.open(next),
			replace: (next: T) => host.replace(next),
			close: (options?: { forget?: boolean }) => {
				if (detail) host.close(detail, options);
			},
			// The destination is a new history step, which already has no detail.
			leaveFor: (navigate: () => void) => navigate(),
		};
	}, [host, localDetail]);
}
