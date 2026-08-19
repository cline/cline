import { desktopClient, isTauriAvailable } from "@/lib/desktop-client";
import {
	APP_ICONS,
	type AppIconId,
	DEFAULT_APP_ICON,
	isRetiredAppIconId,
	RETIRED_APP_ICON_MIGRATIONS,
} from "./app-icon-manifest";

export { APP_ICONS, DEFAULT_APP_ICON };
export type { AppIconId };

export const APP_ICON_STORAGE_KEY = "cline.code.app-icon.v1";

export function isAppIconId(value: unknown): value is AppIconId {
	return APP_ICONS.some((icon) => icon.id === value);
}

export function appIconAssetPath(icon: AppIconId): string {
	return `/app-icons/${icon}.png`;
}

export function readStoredAppIcon(): AppIconId {
	try {
		const stored = window.localStorage.getItem(APP_ICON_STORAGE_KEY);
		if (isRetiredAppIconId(stored)) {
			const migrated = RETIRED_APP_ICON_MIGRATIONS[stored];
			window.localStorage.setItem(APP_ICON_STORAGE_KEY, migrated);
			return migrated;
		}
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
 * icon in the Tauri shell (native `set_app_icon` command) and
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
	await applyAppIcon(icon);
	try {
		window.localStorage.setItem(APP_ICON_STORAGE_KEY, icon);
	} catch {
		// Selection falls back to default next launch; applying still works.
	}
}

/**
 * Re-applies the persisted choice on launch. The dock reverts to the
 * bundled icon on every restart, so the app shell calls this once at boot.
 */
export async function syncAppIcon(): Promise<void> {
	const icon = readStoredAppIcon();
	await applyAppIcon(icon);
}
