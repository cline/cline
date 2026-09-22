/**
 * A supported UI locale, in BCP-47 form. The first segment is always the
 * language; region/script variants are normalized by `resolveLocale`.
 *
 * `"en"` is the default and the ultimate fallback for every lookup.
 */
export type LocaleCode = string;

/**
 * What the user picked in Settings. `"system"` means "derive the locale from
 * the OS / browser language list at startup".
 */
export type LocalePreference = "system" | LocaleCode;

/** A flat catalog of `key -> message template`. The same key set exists in every locale. */
export type Messages = Record<string, string>;

/** Interpolation parameters: `{name}` / `{count}` placeholders. */
export type MessageParams = Record<string, string | number>;

/** Behavior when a translation key is missing. */
export type MissingKeyBehavior = "warn" | "throw" | "silent";

/**
 * The framework-agnostic translator. Pure: it holds an immutable catalog and a
 * resolved locale and never performs IO. Consumers (React, TUI, scripts, Rust
 * codegen) all build on this single shape.
 */
export interface Translator {
	/** The resolved locale this translator renders. */
	readonly locale: LocaleCode;
	/** Translate a message by key, interpolating `{name}` params. */
	t(key: string, params?: MessageParams): string;
	/**
	 * Translate a pluralized message. The template uses
	 * `{count, plural, one {…} other {…}}`; the branch is chosen with
	 * `Intl.PluralRules` for the current locale and `count` is interpolated as `#`.
	 */
	plural(key: string, count: number, params?: MessageParams): string;
	/** Format a number using the current locale. */
	formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
	/** Format a date/time using the current locale. */
	formatDate(
		value: Date | number,
		options?: Intl.DateTimeFormatOptions,
	): string;
	/** Format a relative time using the current locale. */
	formatRelativeTime(
		value: number,
		unit: Intl.RelativeTimeFormatUnit,
		options?: Intl.RelativeTimeFormatOptions,
	): string;
	/** Format a currency amount using the current locale. */
	formatCurrency(
		value: number,
		currency: string,
		options?: Intl.NumberFormatOptions,
	): string;
	/** The display name of a locale, in that locale (e.g. "English", "简体中文"). */
	localeDisplayName(locale: LocaleCode): string;
}
