import { useCallback, useRef } from "react";

/** Keep each mounted card's primary focus target independent of the rendered order. */
export function usePrimaryButtonRefs() {
	const elements = useRef(new Map<string, HTMLButtonElement>());
	const ref = useCallback(
		(key: string) => (element: HTMLButtonElement | null) => {
			if (element) elements.current.set(key, element);
			else elements.current.delete(key);
		},
		[],
	);
	const get = useCallback((key: string) => elements.current.get(key), []);
	return { ref, get };
}
