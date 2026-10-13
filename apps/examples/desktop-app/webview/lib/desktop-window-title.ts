import type { ProcessContext } from "@/hooks/chat-session/types";
import { productNameForVersion, STABLE_PRODUCT_NAME } from "@/lib/app-channel";
import { desktopClient, isTauriAvailable } from "@/lib/desktop-client";

export const DEFAULT_DESKTOP_WINDOW_TITLE = STABLE_PRODUCT_NAME;

export function buildDesktopWindowTitle(version: string | undefined): string {
	const trimmed = version?.trim();
	return trimmed
		? `${productNameForVersion(trimmed)} v${trimmed}`
		: DEFAULT_DESKTOP_WINDOW_TITLE;
}

/**
 * Tauri's window title is static in tauri.conf.json; append the running app
 * version once the sidecar reports it. No-op outside the Tauri shell (e.g.
 * sidecar/web dev mode), where there is no native window to retitle.
 */
export async function syncDesktopWindowTitle(): Promise<void> {
	if (!isTauriAvailable()) {
		return;
	}
	try {
		const ctx = await desktopClient.invoke<ProcessContext>(
			"get_process_context",
		);
		if (!ctx.appVersion?.trim()) {
			return;
		}
		const { getCurrentWindow } = await import("@tauri-apps/api/window");
		await getCurrentWindow().setTitle(buildDesktopWindowTitle(ctx.appVersion));
	} catch {
		// Keep the default static title if the sidecar or window API is unavailable.
	}
}
