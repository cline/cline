"use client";

import { Activity, createContext, type ReactNode, useContext } from "react";

export const OverlayVisibility = createContext(true);

/** Keep overlay state and DOM while suspending visibility and modal effects. */
export function OverlayActivity({ children }: { children: ReactNode }) {
	const visible = useContext(OverlayVisibility);
	return <Activity mode={visible ? "visible" : "hidden"}>{children}</Activity>;
}
