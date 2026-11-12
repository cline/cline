import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Runs one async action at a time. A call made while another is in flight is
 * ignored and `pending` is true meanwhile. Outcomes that arrive while React
 * Activity hides the component are delivered when it becomes visible again;
 * outcomes after a permanent unmount are dropped.
 */
export function useAsyncAction() {
	const [pending, setPending] = useState(false);
	const inFlight = useRef(false);
	const active = useRef(true);
	const deferredOutcome = useRef<(() => void) | null>(null);

	useEffect(() => {
		active.current = true;
		const outcome = deferredOutcome.current;
		deferredOutcome.current = null;
		outcome?.();
		return () => {
			active.current = false;
		};
	}, []);

	const report = useCallback((outcome: () => void) => {
		if (active.current) outcome();
		else deferredOutcome.current = outcome;
	}, []);

	const run = useCallback(
		async <Result>(
			action: () => Promise<Result>,
			{
				onSuccess,
				onError,
			}: {
				onSuccess?: (result: Result) => void;
				onError?: (cause: unknown) => void;
			} = {},
		) => {
			if (inFlight.current) return;
			inFlight.current = true;
			setPending(true);
			let outcome: () => void;
			try {
				const result = await action();
				outcome = () => onSuccess?.(result);
			} catch (cause) {
				outcome = () => onError?.(cause);
			} finally {
				inFlight.current = false;
				// Hidden Activity content still owns this state. React safely ignores
				// the update after a permanent unmount.
				setPending(false);
			}
			report(outcome);
		},
		[report],
	);
	return { pending, run };
}
