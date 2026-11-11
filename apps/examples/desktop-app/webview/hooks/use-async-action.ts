import { useCallback, useRef, useState } from "react";
import { useIsMounted } from "./use-is-mounted";

/**
 * Runs one async action at a time. A call made while another is in flight is
 * ignored, `pending` is true meanwhile, and an outcome that arrives after the
 * component has gone is dropped.
 */
export function useAsyncAction() {
	const [pending, setPending] = useState(false);
	const inFlight = useRef(false);
	const mounted = useIsMounted();
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
			try {
				const result = await action();
				if (mounted.current) onSuccess?.(result);
			} catch (cause) {
				if (mounted.current) onError?.(cause);
			} finally {
				inFlight.current = false;
				if (mounted.current) setPending(false);
			}
		},
		[mounted],
	);
	return { pending, run };
}
