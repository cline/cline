"use client";

import { useEffect, useState } from "react";

/**
 * True while this window is the one the user is actually looking at.
 *
 * The decorative aurora is the single largest source of render work in the
 * app — on a machine without GPU compositing it costs roughly two cores
 * continuously — and a window that is minimised, on another desktop, or simply
 * behind the user's editor gets nothing back for that. Starts `true` so the
 * server and first client render agree; the effect corrects it after mount.
 */
export function useWindowActive(): boolean {
	const [active, setActive] = useState(true);

	useEffect(() => {
		const sync = () => setActive(!document.hidden && document.hasFocus());
		sync();
		window.addEventListener("focus", sync);
		window.addEventListener("blur", sync);
		document.addEventListener("visibilitychange", sync);
		return () => {
			window.removeEventListener("focus", sync);
			window.removeEventListener("blur", sync);
			document.removeEventListener("visibilitychange", sync);
		};
	}, []);

	return active;
}
