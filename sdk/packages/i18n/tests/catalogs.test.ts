import { describe, expect, it } from "vitest";
import {
	createI18nInstance,
	DEFAULT_LOCALE,
	NAMESPACES,
	resolveLocale,
	resources,
	SUPPORTED_LOCALES,
} from "../src/index";

const PLURAL_SUFFIXES = ["zero", "one", "two", "few", "many", "other"];

/** Flattens a catalog into dot-joined key paths, collapsing CLDR plural suffixes ("x_one", "x_other" → "x"). */
function flattenKeys(value: unknown, prefix = ""): string[] {
	if (typeof value !== "object" || value === null) {
		const withoutSuffix = PLURAL_SUFFIXES.reduce(
			(key, suffix) =>
				key.endsWith(`_${suffix}`) ? key.slice(0, -(suffix.length + 1)) : key,
			prefix,
		);
		return [withoutSuffix];
	}
	return Object.entries(value).flatMap(([key, child]) =>
		flattenKeys(child, prefix ? `${prefix}.${key}` : key),
	);
}

describe("catalog parity", () => {
	const sourceKeys = Object.fromEntries(
		NAMESPACES.map((ns) => [
			ns,
			new Set(flattenKeys(resources[DEFAULT_LOCALE][ns])),
		]),
	);

	for (const locale of SUPPORTED_LOCALES) {
		if (locale === DEFAULT_LOCALE) {
			continue;
		}
		for (const ns of NAMESPACES) {
			it(`${locale}/${ns} has exactly the keys of ${DEFAULT_LOCALE}/${ns}`, () => {
				const localeKeys = new Set(flattenKeys(resources[locale][ns]));
				const missing = [...sourceKeys[ns]].filter(
					(key) => !localeKeys.has(key),
				);
				const extra = [...localeKeys].filter((key) => !sourceKeys[ns].has(key));
				expect({ extra, missing }).toEqual({ extra: [], missing: [] });
			});
		}
	}
});

describe("resolveLocale", () => {
	it("matches exact locales case-insensitively", () => {
		expect(resolveLocale("zh-cn")).toBe("zh-CN");
		expect(resolveLocale("ES")).toBe("es");
	});
	it("falls back to a base-language match", () => {
		expect(resolveLocale("es-419")).toBe("es");
		expect(resolveLocale("zh-tw")).toBe("zh-CN");
		expect(resolveLocale("ru-RU")).toBe("ru");
	});
	it("defaults to English for auto, unknown, and empty values", () => {
		expect(resolveLocale("auto")).toBe("en");
		expect(resolveLocale("fr")).toBe("en");
		expect(resolveLocale(undefined)).toBe("en");
	});
});

describe("createI18nInstance", () => {
	it("translates with plural forms per locale", () => {
		const en = createI18nInstance("en");
		expect(en.t("history:deleteSelected", { count: 1 })).toBe(
			"Delete Selected",
		);
		expect(en.t("history:deleteSelected", { count: 3 })).toBe(
			"Delete 3 Selected",
		);

		const ru = createI18nInstance("ru");
		expect(ru.t("history:deleteSelected", { count: 2 })).toBe(
			"Удалить 2 выбранных",
		);

		const zh = createI18nInstance("zh-CN");
		expect(zh.t("history:deleteSelected", { count: 1 })).toBe(
			"删除选中的 1 项",
		);
	});

	it("falls back to English for unsupported locales", () => {
		const instance = createI18nInstance("fr");
		expect(instance.t("history:title")).toBe("History");
	});

	it("switches languages at runtime", async () => {
		const instance = createI18nInstance("en");
		await instance.changeLanguage("ko");
		expect(instance.t("history:title")).toBe("기록");
	});
});
