/**
 * Selectable app icons shared by the settings UI and asset synchronization.
 * Keep the native allowlist in src-tauri/src/main.rs aligned; the sync script
 * validates it before builds and typechecks.
 */
export const APP_ICONS = [
	{ id: "classic", label: "Classic" },
	{ id: "midnight", label: "Midnight" },
	{ id: "hologram", label: "Hologram" },
	{ id: "chip", label: "Chip" },
] as const;

export type AppIconId = (typeof APP_ICONS)[number]["id"];

export const APP_ICON_IDS = APP_ICONS.map((icon) => icon.id);
export const DEFAULT_APP_ICON: AppIconId = "midnight";

export const RETIRED_APP_ICON_MIGRATIONS = {
	sunrise: "hologram",
	steel: DEFAULT_APP_ICON,
} as const satisfies Record<string, AppIconId>;

export type RetiredAppIconId = keyof typeof RETIRED_APP_ICON_MIGRATIONS;

export function isRetiredAppIconId(value: unknown): value is RetiredAppIconId {
	return (
		typeof value === "string" &&
		Object.prototype.hasOwnProperty.call(RETIRED_APP_ICON_MIGRATIONS, value)
	);
}
