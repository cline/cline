"use client";

import { createContext, useContext } from "react";

// Portals escape hidden/inert ancestors. Suspend their content and modal
// effects while the owning app is unavailable, preserving the app's state.
export const OverlayVisibility = createContext(true);

export function useOverlayVisibility() {
	return useContext(OverlayVisibility);
}
