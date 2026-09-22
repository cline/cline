/**
 * Locale-aware formatting helpers. These are thin, memoized wrappers over the
 * built-in `Intl` formatters so the UI never hardcodes a locale like "en-US".
 */
export function makeFormatters(locale: string) {
	const numberCache = new Map<string, Intl.NumberFormat>();
	const dateCache = new Map<string, Intl.DateTimeFormat>();
	const relativeCache = new Map<string, Intl.RelativeTimeFormat>();

	const numberFor = (options?: Intl.NumberFormatOptions) => {
		const key = JSON.stringify(options ?? {});
		let fmt = numberCache.get(key);
		if (!fmt) {
			fmt = new Intl.NumberFormat(locale, options);
			numberCache.set(key, fmt);
		}
		return fmt;
	};
	const dateFor = (options?: Intl.DateTimeFormatOptions) => {
		const key = JSON.stringify(options ?? {});
		let fmt = dateCache.get(key);
		if (!fmt) {
			fmt = new Intl.DateTimeFormat(locale, options);
			dateCache.set(key, fmt);
		}
		return fmt;
	};
	const relativeFor = (options?: Intl.RelativeTimeFormatOptions) => {
		const key = JSON.stringify(options ?? { numeric: "auto" });
		let fmt = relativeCache.get(key);
		if (!fmt) {
			fmt = new Intl.RelativeTimeFormat(locale, options ?? { numeric: "auto" });
			relativeCache.set(key, fmt);
		}
		return fmt;
	};

	return {
		formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
			numberFor(options).format(value),
		formatDate: (value: Date | number, options?: Intl.DateTimeFormatOptions) =>
			dateFor(options).format(value),
		formatRelativeTime: (
			value: number,
			unit: Intl.RelativeTimeFormatUnit,
			options?: Intl.RelativeTimeFormatOptions,
		) => relativeFor(options).format(value, unit),
		formatCurrency: (
			value: number,
			currency: string,
			options?: Intl.NumberFormatOptions,
		) => numberFor({ style: "currency", currency, ...options }).format(value),
	};
}
