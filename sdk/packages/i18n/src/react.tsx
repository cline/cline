import {
	createContext,
	type ReactNode,
	useContext,
	useSyncExternalStore,
} from "react";
import { createTranslator } from "./index.js";
import type { LocaleCode, Messages, Translator } from "./types.js";

/**
 * A tiny external store over the active translator. The host app owns the
 * single instance and calls `store.set(...)` when the locale changes; React
 * re-renders only subscribed components via `useSyncExternalStore`.
 */
export interface I18nStore {
	getSnapshot: () => Translator;
	subscribe: (onChange: () => void) => () => void;
	set: (translator: Translator) => void;
}

export function createI18nStore(initial: Translator): I18nStore {
	let current = initial;
	const listeners = new Set<() => void>();
	return {
		getSnapshot: () => current,
		subscribe: (onChange) => {
			listeners.add(onChange);
			return () => listeners.delete(onChange);
		},
		set: (translator) => {
			if (translator === current) {
				return;
			}
			current = translator;
			for (const listener of listeners) {
				listener();
			}
		},
	};
}

const I18nContext = createContext<I18nStore | null>(null);

/**
 * Optional store used by `useTranslation` when no provider is mounted. Hosts
 * that render components outside an `I18nProvider` (component tests, legacy
 * surfaces mid-migration) can register an English store so `t()` keeps
 * returning the source strings instead of throwing.
 */
let defaultStore: I18nStore | null = null;

export function setDefaultI18nStore(store: I18nStore): void {
	defaultStore = store;
}

export interface I18nProviderProps {
	/** The store created once by the host app (see `createI18nStore`). */
	store: I18nStore;
	children: ReactNode;
}

export function I18nProvider({ store, children }: I18nProviderProps) {
	return <I18nContext.Provider value={store}>{children}</I18nContext.Provider>;
}

function useStore(): I18nStore {
	const store = useContext(I18nContext) ?? defaultStore;
	if (!store) {
		throw new Error(
			"useTranslation must be used within an <I18nProvider> (or register a fallback with setDefaultI18nStore)",
		);
	}
	return store;
}

/** Subscribe to the active translator; re-renders when the locale changes. */
export function useTranslation(): Translator {
	const store = useStore();
	return useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);
}

/** Subscribe to just the active locale code. */
export function useLocale(): LocaleCode {
	return useTranslation().locale;
}

/** Build a translator for a locale from injected catalogs (host-side helper). */
export function buildTranslator(
	locale: LocaleCode,
	messages: Messages,
	fallbackMessages: Messages,
	missing: "warn" | "throw" | "silent" = "warn",
): Translator {
	return createTranslator({ locale, messages, fallbackMessages, missing });
}
