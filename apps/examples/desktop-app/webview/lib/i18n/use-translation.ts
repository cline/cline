import { useCallback, useEffect, useState } from "react";
import {
	type AppLocaleCode,
	readStoredAppLocale,
	setStoredAppLocale,
	subscribeToAppLocale,
} from "@/lib/app-locale";
import { type TranslationParams, translateWith } from "./translate";

export interface UseTranslation {
	/** The locale currently rendered. */
	locale: AppLocaleCode;
	/**
	 * Translate the English source text. Unwired or missing strings return the
	 * source unchanged, so this is safe to call anywhere.
	 */
	t: (source: string, params?: TranslationParams) => string;
	/** Persist a new locale and re-render every subscriber. */
	setLocale: (locale: AppLocaleCode) => void;
}

/**
 * Subscribes a component to the interface language.
 *
 * Re-render is driven by an explicit event rather than context: the locale is
 * read at module scope by the bootstrap script, changes are rare, and an event
 * avoids forcing a provider above every surface (hub window, dialogs, popovers)
 * that would have to stay in sync.
 */
export function useTranslation(): UseTranslation {
	const [locale, setLocaleState] = useState<AppLocaleCode>(() =>
		readStoredAppLocale(),
	);

	useEffect(() => subscribeToAppLocale((next) => setLocaleState(next)), []);

	const t = useCallback(
		(source: string, params?: TranslationParams) =>
			translateWith(locale, source, params),
		[locale],
	);

	return {
		locale,
		t,
		setLocale: (next: AppLocaleCode) => {
			setLocaleState(setStoredAppLocale(next));
		},
	};
}
