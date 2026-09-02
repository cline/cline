// GENERATED FILE — do not edit by hand. Regenerate with `bun run translate -- --regen`
// (from sdk/packages/i18n). Locales and namespaces are discovered from
// src/locales/<locale>/<namespace>.json; new languages are registered here automatically.
import enCommon from "./locales/en/common.json";
import enHistory from "./locales/en/history.json";
import enNotifications from "./locales/en/notifications.json";
import enSettings from "./locales/en/settings.json";
import esCommon from "./locales/es/common.json";
import esHistory from "./locales/es/history.json";
import esNotifications from "./locales/es/notifications.json";
import esSettings from "./locales/es/settings.json";
import koCommon from "./locales/ko/common.json";
import koHistory from "./locales/ko/history.json";
import koNotifications from "./locales/ko/notifications.json";
import koSettings from "./locales/ko/settings.json";
import ruCommon from "./locales/ru/common.json";
import ruHistory from "./locales/ru/history.json";
import ruNotifications from "./locales/ru/notifications.json";
import ruSettings from "./locales/ru/settings.json";
import zhCNCommon from "./locales/zh-CN/common.json";
import zhCNHistory from "./locales/zh-CN/history.json";
import zhCNNotifications from "./locales/zh-CN/notifications.json";
import zhCNSettings from "./locales/zh-CN/settings.json";

export const NAMESPACES = [
	"common",
	"history",
	"notifications",
	"settings",
] as const;
export type Namespace = (typeof NAMESPACES)[number];

/** Native-script display names for the language picker. */
export const LOCALE_DISPLAY_NAMES = {
	en: "English",
	es: "Español",
	ko: "한국어",
	ru: "Русский",
	"zh-CN": "简体中文",
};

/** All message catalogs, keyed by locale then namespace. English is the source catalog. */
export const resources = {
	en: {
		common: enCommon,
		history: enHistory,
		notifications: enNotifications,
		settings: enSettings,
	},
	es: {
		common: esCommon,
		history: esHistory,
		notifications: esNotifications,
		settings: esSettings,
	},
	ko: {
		common: koCommon,
		history: koHistory,
		notifications: koNotifications,
		settings: koSettings,
	},
	ru: {
		common: ruCommon,
		history: ruHistory,
		notifications: ruNotifications,
		settings: ruSettings,
	},
	"zh-CN": {
		common: zhCNCommon,
		history: zhCNHistory,
		notifications: zhCNNotifications,
		settings: zhCNSettings,
	},
} as const;
