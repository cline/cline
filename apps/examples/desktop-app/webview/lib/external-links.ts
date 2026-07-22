import { openUrl } from "@tauri-apps/plugin-opener";
import type { MouseEvent } from "react";
import { isTauriAvailable } from "@/lib/desktop-client";

function normalizeExternalWebUrl(url: string): string {
	const parsed = new URL(url);
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		throw new Error("External URL must use http(s)");
	}
	return parsed.toString();
}

/** Open a web URL using the host available at runtime. */
export async function openExternalUrl(url: string): Promise<void> {
	const normalizedUrl = normalizeExternalWebUrl(url);
	if (isTauriAvailable()) {
		await openUrl(normalizedUrl);
		return;
	}

	window.open(normalizedUrl, "_blank", "noopener,noreferrer");
}

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
	void openExternalUrl(event.currentTarget.href).catch((error: unknown) => {
		console.error("Failed to open external URL", error);
	});
}
