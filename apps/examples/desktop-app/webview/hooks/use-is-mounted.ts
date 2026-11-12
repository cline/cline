import { useEffect, useRef } from "react";

/** Whether the component is still on screen, for async work that can finish after it has gone. */
export function useIsMounted() {
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	return mounted;
}
