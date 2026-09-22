"use client";

import type { Messages } from "@cline/i18n";
import enMessages from "@cline/i18n/locales/en.json";
import zhHansMessages from "@cline/i18n/locales/zh-Hans.json";
import {
	buildTranslator,
	createI18nStore,
	I18nProvider,
	type I18nStore,
	setDefaultI18nStore,
	type Translator,
	useTranslation,
} from "@cline/i18n/react";
import { Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { desktopClient, isTauriAvailable } from "@/lib/desktop-client";
import {
	APP_LOCALES,
	type AppLocale,
	type AppLocalePreference,
	DEFAULT_APP_LOCALE,
	readInitialLocale,
	readStoredLocalePreference,
	resolveAppLocale,
	setStoredLocale,
	subscribeToLocale,
} from "@/lib/locale";

/**
 * Locale catalogs. Both shipped locales are bundled statically: the desktop
 * loads them from local files, and a synchronous catalog is what lets the app
 * render its first localized frame with no loading gap and no English flash.
 */
const CATALOGS: Record<AppLocale, Messages> = {
	en: enMessages as Messages,
	"zh-Hans": zhHansMessages as Messages,
};

/**
 * Single external store for the active translator. Created once per app; the
 * I18nRoot gate fills in the resolved locale after mount, and language
 * switches call `set()` to re-render every subscribed component.
 */
export const i18nStore: I18nStore = createI18nStore(
	buildTranslator(
		DEFAULT_APP_LOCALE,
		CATALOGS[DEFAULT_APP_LOCALE],
		CATALOGS.en,
		"warn",
	),
);

// Components rendered outside the provider (component tests, surfaces that
// have not been gated yet) translate with the source English catalog so their
// output is unchanged during the incremental migration.
setDefaultI18nStore(i18nStore);

function translatorFor(locale: AppLocale) {
	return buildTranslator(locale, CATALOGS[locale], CATALOGS.en, "warn");
}

function notifyNativeLocale(locale: AppLocale): void {
	if (!isTauriAvailable()) {
		return;
	}
	void (async () => {
		try {
			const { invoke } = await import("@tauri-apps/api/core");
			await invoke("set_app_language", { locale });
		} catch {
			// Native menu relabeling is best-effort; the webview is already switched.
		}
	})();
}

/**
 * Apply a locale to the running app: render mirror, document attributes,
 * translator store, and native menus. Does NOT persist — callers that come
 * from a user action must persist the preference themselves (see the Language
 * setting, which surfaces persistence failures as a toast).
 */
export function applyAppLocale(preference: AppLocalePreference): AppLocale {
	const locale = resolveAppLocale(preference, navigator.languages ?? []);
	setStoredLocale(locale);
	i18nStore.set(translatorFor(locale));
	notifyNativeLocale(locale);
	return locale;
}

/**
 * Root gate. The prerendered static HTML cannot know the user's locale, so the
 * localized tree mounts only after the bootstrap-resolved locale is applied.
 * Until then it renders a textless shell (same background/spinner as the
 * existing view loaders), so no English text ever flashes for a zh user and
 * hydration stays consistent.
 */
export function I18nRoot({ children }: { children: ReactNode }) {
	const [ready, setReady] = useState(false);
	useEffect(() => {
		const locale = readInitialLocale();
		i18nStore.set(translatorFor(locale));
		setReady(true);
		// The localStorage mirror is a fast, synchronous source, but the sidecar
		// copy is authoritative. Correct the mirror when they disagree (e.g. the
		// preference was changed by another client or the mirror was cleared).
		void desktopClient
			.invoke<{ language?: unknown }>("get_desktop_settings")
			.then((settings) => {
				const stored = settings?.language;
				if (
					(stored === "system" ||
						(typeof stored === "string" &&
							(APP_LOCALES as readonly string[]).includes(stored))) &&
					stored !== readStoredLocalePreference()
				) {
					applyAppLocale(stored as AppLocalePreference);
				}
			})
			.catch(() => {
				// Authority is best-effort; the mirror already reflects this client.
			});
		return subscribeToLocale((locale) => {
			i18nStore.set(translatorFor(locale));
		});
	}, []);
	if (!ready) {
		return (
			<div className="flex h-full flex-1 items-center justify-center bg-background">
				<Loader2 className="size-5 animate-spin text-muted-foreground" />
			</div>
		);
	}
	return <I18nProvider store={i18nStore}>{children}</I18nProvider>;
}

/**
 * Current translator for non-React code paths (notification builders, error
 * humanizers, pure helper functions) that cannot call hooks. Reads the live
 * store snapshot, so it reflects locale switches.
 */
export function getTranslator(): Translator {
	return i18nStore.getSnapshot();
}

export { useTranslation };
