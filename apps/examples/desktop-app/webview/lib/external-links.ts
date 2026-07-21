import { openUrl } from "@tauri-apps/plugin-opener";
import type { MouseEvent } from "react";
import { isTauriAvailable } from "@/lib/desktop-client";

/**
 * Open an external anchor with the operating system's default application
 * when rendered inside the Tauri shell. In a regular browser, leave the
 * anchor's native navigation behavior unchanged.
 */
export function handleExternalLinkClick(
	event: MouseEvent<HTMLAnchorElement>,
): void {
	if (!isTauriAvailable()) return;

	event.preventDefault();
	void openUrl(event.currentTarget.href).catch((error: unknown) => {
		console.error("Failed to open external URL", error);
	});
}
