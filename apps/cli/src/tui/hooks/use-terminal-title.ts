import { useEffect } from "react";

export interface TerminalTitleRenderer {
	readonly isDestroyed: boolean;
	setTerminalTitle(title: string): void;
}

export function useTerminalTitle(
	renderer: TerminalTitleRenderer,
	terminalTitle: string,
): void {
	// setTerminalTitle writes into memory owned by the native renderer, so it
	// must never run after destroy. React can flush passive effects after the
	// renderer's memory has been freed.
	useEffect(() => {
		if (renderer.isDestroyed) {
			return;
		}
		renderer.setTerminalTitle(terminalTitle);
	}, [renderer, terminalTitle]);

	useEffect(() => {
		return () => {
			if (!renderer.isDestroyed) {
				renderer.setTerminalTitle("");
			}
		};
	}, [renderer]);
}
