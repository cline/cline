import { desktopClient, isTauriAvailable } from "@/lib/desktop-client";

export const APP_ICON_STORAGE_KEY = "cline.code.app-icon.v1";

/**
 * App icon variants selectable in Settings. "classic" is the icon bundled
 * with the app; the others live in webview/public/app-icons (picker +
 * browser favicon) and src-tauri/icons/dock (runtime dock icon resources).
 */
export const APP_ICONS = [
	{ id: "classic", label: "Classic" },
	{ id: "sunrise", label: "Sunrise" },
	{ id: "steel", label: "Steel" },
	{ id: "midnight", label: "Midnight" },
] as const;

export type AppIconId = (typeof APP_ICONS)[number]["id"];

export const DEFAULT_APP_ICON: AppIconId = "classic";

export function isAppIconId(value: unknown): value is AppIconId {
	return APP_ICONS.some((icon) => icon.id === value);
}

export function appIconAssetPath(icon: AppIconId): string {
	return `/app-icons/${icon}.png`;
}

export function readStoredAppIcon(): AppIconId {
	try {
		const stored = window.localStorage.getItem(APP_ICON_STORAGE_KEY);
		return isAppIconId(stored) ? stored : DEFAULT_APP_ICON;
	} catch {
		return DEFAULT_APP_ICON;
	}
}

function applyFavicon(icon: AppIconId): void {
	let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
	if (!link) {
		link = document.createElement("link");
		link.rel = "icon";
		document.head.appendChild(link);
	}
	link.href = appIconAssetPath(icon);
}

/**
 * Applies the icon to whatever this runtime can control: the macOS dock
 * icon in the Tauri shell (native `set_app_icon` command, best-effort) and
 * the favicon in browser dev mode so the choice is still visible there.
 */
export async function applyAppIcon(icon: AppIconId): Promise<void> {
	applyFavicon(icon);
	if (!isTauriAvailable()) {
		return;
	}
	await desktopClient.invoke("set_app_icon", { icon });
}

export async function setStoredAppIcon(icon: AppIconId): Promise<void> {
	try {
		window.localStorage.setItem(APP_ICON_STORAGE_KEY, icon);
	} catch {
		// Selection falls back to default next launch; applying still works.
	}
	await applyAppIcon(icon);
}

/**
 * Re-applies the persisted choice on launch. The dock reverts to the
 * bundled icon on every restart, so the app shell calls this once at boot.
 */
export async function syncAppIcon(): Promise<void> {
	const icon = readStoredAppIcon();
	if (icon !== DEFAULT_APP_ICON) {
		await applyAppIcon(icon);
	}
}
