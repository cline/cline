import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import zhHans from "../locales/zh-Hans.json";
import { createTranslator } from "../src/index.js";
import { extractPlaceholders, interpolate } from "../src/interpolate.js";
import {
	DEFAULT_LOCALE,
	normalizeTag,
	resolveLocale,
} from "../src/normalize.js";
import { isPluralTemplate, renderPlural } from "../src/plural.js";
import type { Messages } from "../src/types.js";

const enMessages = en as Messages;
const zhMessages = zhHans as Messages;

describe("normalizeTag", () => {
	it("collapses Chinese variants to script tags", () => {
		expect(normalizeTag("zh-CN")).toBe("zh-Hans");
		expect(normalizeTag("zh_SG")).toBe("zh-Hans");
		expect(normalizeTag("zh-Hans-CN")).toBe("zh-Hans");
		expect(normalizeTag("zh-TW")).toBe("zh-Hant");
		expect(normalizeTag("zh-Hant-HK")).toBe("zh-Hant");
	});

	it("keeps the base language for Latin locales", () => {
		expect(normalizeTag("en-US")).toBe("en");
		expect(normalizeTag("EN")).toBe("en");
	});

	it("falls back to the default for garbage input", () => {
		expect(normalizeTag("")).toBe(DEFAULT_LOCALE);
		expect(normalizeTag("   ")).toBe(DEFAULT_LOCALE);
	});
});

describe("resolveLocale", () => {
	const available = ["en", "zh-Hans"];

	it("honors an explicit preference", () => {
		expect(resolveLocale("zh-Hans", [], available)).toBe("zh-Hans");
	});

	it("falls back to zh-Hans for zh-Hant when no Traditional catalog ships", () => {
		expect(resolveLocale("zh-TW", [], available)).toBe("zh-Hans");
	});

	it("resolves system candidates in order", () => {
		expect(resolveLocale("system", ["fr-FR", "zh-CN"], available)).toBe(
			"zh-Hans",
		);
		expect(resolveLocale("system", ["en-GB", "de"], available)).toBe("en");
	});

	it("falls back to the default locale when nothing matches", () => {
		expect(resolveLocale("system", ["fr", "de"], available)).toBe("en");
		expect(resolveLocale("system", [], available)).toBe("en");
	});
});

describe("interpolate", () => {
	it("replaces named placeholders", () => {
		expect(
			interpolate("Hello {name} v{version}", { name: "Cline", version: 1 }),
		).toBe("Hello Cline v1");
	});

	it("leaves unknown placeholders readable instead of crashing", () => {
		expect(interpolate("Hi {missing}", { other: "x" })).toBe("Hi {missing}");
	});

	it("treats templates without params verbatim", () => {
		expect(interpolate("raw {name}", undefined)).toBe("raw {name}");
	});
});

describe("extractPlaceholders", () => {
	it("collects simple placeholders and ignores plural markers", () => {
		// `{count, plural, …}` is a plural marker: `count` is supplied by the
		// plural() API rather than by named params, so it is not reported here.
		expect(
			extractPlaceholders("Hi {name}, {count, plural, other {# of {name}}}"),
		).toEqual(["name"]);
		expect(extractPlaceholders("Hub command failed: {command}")).toEqual([
			"command",
		]);
		expect(extractPlaceholders("No placeholders here")).toEqual([]);
	});
});

describe("plural", () => {
	it("detects plural templates", () => {
		expect(isPluralTemplate(enMessages["native.tray.sessionsRunning"])).toBe(
			true,
		);
		expect(isPluralTemplate(enMessages["common.action.cancel"])).toBe(false);
	});

	it("renders the English one/other branches with a formatted count", () => {
		const translator = createTranslator({
			locale: "en",
			messages: enMessages,
			missing: "silent",
		});
		expect(translator.plural("native.tray.sessionsRunning", 1)).toBe(
			"1 session running",
		);
		expect(translator.plural("native.tray.sessionsRunning", 3)).toBe(
			"3 sessions running",
		);
	});

	it("renders the Chinese other-branch only", () => {
		const translator = createTranslator({
			locale: "zh-Hans",
			messages: zhMessages,
			fallbackMessages: enMessages,
			missing: "silent",
		});
		expect(translator.plural("native.tray.sessionsRunning", 1)).toBe(
			"1 个会话正在运行",
		);
		expect(translator.plural("native.tray.sessionsRunning", 5)).toBe(
			"5 个会话正在运行",
		);
	});

	it("renders plurals through the raw helper too", () => {
		expect(
			renderPlural(enMessages["native.tray.sessionsRunning"], "en", 2, {}),
		).toBe("2 sessions running");
	});
});

describe("createTranslator", () => {
	it("translates with the target catalog", () => {
		const translator = createTranslator({
			locale: "zh-Hans",
			messages: zhMessages,
			fallbackMessages: enMessages,
			missing: "silent",
		});
		expect(translator.t("settings.general.language.title")).toBe("语言");
		expect(translator.t("native.tray.newSession")).toBe("新建会话");
	});

	it("falls back to the English catalog for missing keys", () => {
		const translator = createTranslator({
			locale: "zh-Hans",
			messages: { "only.en": "English only" },
			fallbackMessages: enMessages,
			missing: "silent",
		});
		expect(translator.t("only.en")).toBe("English only");
		expect(translator.t("common.action.cancel")).toBe("Cancel");
	});

	it("returns the key itself when nothing matches", () => {
		const translator = createTranslator({
			locale: "en",
			messages: {},
			missing: "silent",
		});
		expect(translator.t("nope.missing.key")).toBe("nope.missing.key");
	});

	it("throws for missing keys in throw mode", () => {
		const translator = createTranslator({
			locale: "en",
			messages: {},
			missing: "throw",
		});
		expect(() => translator.t("nope.missing.key")).toThrow(
			/missing translation/,
		);
	});

	it("interpolates params through t()", () => {
		const translator = createTranslator({
			locale: "en",
			messages: enMessages,
			missing: "silent",
		});
		expect(
			translator.t("settings.general.language.systemHint", {
				languageName: "English",
			}),
		).toBe("Currently using English");
	});

	it("formats numbers and currency with the locale", () => {
		const zh = createTranslator({
			locale: "zh-Hans",
			messages: {},
			missing: "silent",
		});
		const en = createTranslator({
			locale: "en",
			messages: {},
			missing: "silent",
		});
		expect(en.formatNumber(1234)).toMatch(/1,234/);
		expect(zh.formatNumber(1234)).toMatch(/1,234/);
		expect(en.formatCurrency(2, "USD")).toContain("2");
	});

	it("exposes self-describing locale names", () => {
		const translator = createTranslator({
			locale: "en",
			messages: {},
			missing: "silent",
		});
		expect(translator.localeDisplayName("en")).toBe("English");
		expect(translator.localeDisplayName("zh-Hans")).toBe("简体中文");
	});
});
