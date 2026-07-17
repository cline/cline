"use client";

import { isTauriAvailable } from "@/lib/desktop-client";

/** Whether we're running inside the Tauri desktop shell (vs plain web/dev). */
export function isTauri(): boolean {
	return isTauriAvailable();
}

async function invokeTauri<T>(
	command: string,
	args?: Record<string, unknown>,
): Promise<T | null> {
	if (!isTauriAvailable()) {
		return null;
	}
	try {
		const { invoke } = await import("@tauri-apps/api/core");
		return await invoke<T>(command, args);
	} catch (error) {
		console.error(`pet-window: ${command} failed`, error);
		return null;
	}
}

/**
 * The label of the Tauri window this document is running in ("main" or "pet"),
 * or null when not running under Tauri. Used to decide whether to render the
 * full app or just the floating pet.
 */
export async function getCurrentWindowLabel(): Promise<string | null> {
	if (!isTauriAvailable()) {
		return null;
	}
	try {
		const { getCurrentWindow } = await import("@tauri-apps/api/window");
		return getCurrentWindow().label;
	} catch {
		return null;
	}
}

/** Begin an OS-level drag of the pet window (called from the pet's webview). */
export const startPetDrag = () => invokeTauri("start_pet_drag");

/** Show the floating pet window and reassert its always-on-top presence. */
export const showPet = () => invokeTauri("show_pet");

/** Hide the floating pet window. */
export const hidePet = () => invokeTauri("hide_pet");

/** Whether the floating pet window is currently visible. */
export const isPetVisible = async (): Promise<boolean> =>
	(await invokeTauri<boolean>("is_pet_visible")) ?? false;

/** Reopen (show + focus) the main app window after it was closed/hidden. */
export const showMainWindow = () => invokeTauri("show_main_window");
