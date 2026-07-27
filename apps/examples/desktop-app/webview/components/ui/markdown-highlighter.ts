import type {
	HighlighterCore,
	LanguageRegistration,
	ThemeRegistration,
} from "shiki/core";
import type { CodeHighlighterPlugin } from "streamdown";

type HighlightResult = NonNullable<
	ReturnType<CodeHighlighterPlugin["highlight"]>
>;

export const SUPPORTED_MARKDOWN_LANGUAGES = [
	"bash",
	"css",
	"diff",
	"html",
	"javascript",
	"json",
	"jsonc",
	"jsx",
	"markdown",
	"python",
	"shellscript",
	"tsx",
	"typescript",
	"yaml",
] as const;

type SupportedMarkdownLanguage = (typeof SUPPORTED_MARKDOWN_LANGUAGES)[number];

const SUPPORTED_LANGUAGE_SET = new Set<string>(SUPPORTED_MARKDOWN_LANGUAGES);

const LANGUAGE_ALIASES: Record<string, SupportedMarkdownLanguage> = {
	cjs: "javascript",
	console: "shellscript",
	htm: "html",
	js: "javascript",
	json5: "jsonc",
	md: "markdown",
	mjs: "javascript",
	py: "python",
	sh: "shellscript",
	shell: "shellscript",
	ts: "typescript",
	yml: "yaml",
};

const LANGUAGE_LOADERS: Record<
	SupportedMarkdownLanguage,
	() => Promise<LanguageRegistration[]>
> = {
	bash: () => import("@shikijs/langs/bash").then((module) => module.default),
	css: () => import("@shikijs/langs/css").then((module) => module.default),
	diff: () => import("@shikijs/langs/diff").then((module) => module.default),
	html: () => import("@shikijs/langs/html").then((module) => module.default),
	javascript: () =>
		import("@shikijs/langs/javascript").then((module) => module.default),
	json: () => import("@shikijs/langs/json").then((module) => module.default),
	jsonc: () => import("@shikijs/langs/jsonc").then((module) => module.default),
	jsx: () => import("@shikijs/langs/jsx").then((module) => module.default),
	markdown: () =>
		import("@shikijs/langs/markdown").then((module) => module.default),
	python: () =>
		import("@shikijs/langs/python").then((module) => module.default),
	shellscript: () =>
		import("@shikijs/langs/shellscript").then((module) => module.default),
	tsx: () => import("@shikijs/langs/tsx").then((module) => module.default),
	typescript: () =>
		import("@shikijs/langs/typescript").then((module) => module.default),
	yaml: () => import("@shikijs/langs/yaml").then((module) => module.default),
};

const LIGHT_THEME = "github-light";
const DARK_THEME = "github-dark";
const MAX_CACHED_RESULTS = 256;

let highlighterPromise: Promise<HighlighterCore> | undefined;
let themesPromise: Promise<void> | undefined;
const languagePromises = new Map<SupportedMarkdownLanguage, Promise<void>>();
const resultCache = new Map<string, HighlightResult>();
const pendingHighlights = new Map<string, Promise<HighlightResult>>();
const loggedFailures = new Set<string>();

function normalizeLanguage(language: string): SupportedMarkdownLanguage | null {
	const normalized = language.trim().toLowerCase();
	if (!normalized) return null;
	const aliased = LANGUAGE_ALIASES[normalized] ?? normalized;
	return SUPPORTED_LANGUAGE_SET.has(aliased)
		? (aliased as SupportedMarkdownLanguage)
		: null;
}

function getHighlighter(): Promise<HighlighterCore> {
	if (!highlighterPromise) {
		highlighterPromise = Promise.all([
			import("shiki/core"),
			import("shiki/engine/javascript"),
		]).then(([core, engine]) =>
			core.createHighlighterCore({
				engine: engine.createJavaScriptRegexEngine({ forgiving: true }),
			}),
		);
	}
	return highlighterPromise;
}

function ensureThemes(highlighter: HighlighterCore): Promise<void> {
	if (!themesPromise) {
		themesPromise = Promise.all([
			import("@shikijs/themes/github-light").then((module) => module.default),
			import("@shikijs/themes/github-dark").then((module) => module.default),
		]).then((themes: ThemeRegistration[]) => highlighter.loadTheme(...themes));
	}
	return themesPromise;
}

function ensureLanguage(
	highlighter: HighlighterCore,
	language: SupportedMarkdownLanguage,
): Promise<void> {
	const existing = languagePromises.get(language);
	if (existing) return existing;

	const loading = LANGUAGE_LOADERS[language]().then((registrations) =>
		highlighter.loadLanguage(...registrations),
	);
	languagePromises.set(language, loading);
	return loading;
}

function rawHighlight(code: string): HighlightResult {
	return {
		bg: "transparent",
		fg: "inherit",
		tokens: code.split("\n").map((line) =>
			line
				? [
						{
							bgColor: "transparent",
							color: "inherit",
							content: line,
							htmlStyle: {},
							offset: 0,
						},
					]
				: [],
		),
	};
}

function cacheResult(key: string, result: HighlightResult): void {
	resultCache.delete(key);
	resultCache.set(key, result);
	if (resultCache.size <= MAX_CACHED_RESULTS) return;

	const oldestKey = resultCache.keys().next().value;
	if (oldestKey !== undefined) resultCache.delete(oldestKey);
}

function reportHighlightFailure(
	language: SupportedMarkdownLanguage,
	error: unknown,
): void {
	if (loggedFailures.has(language)) return;
	loggedFailures.add(language);
	console.warn(
		`Syntax highlighting unavailable for ${language}; rendering plain code.`,
		error,
	);
}

function loadHighlight(
	code: string,
	language: SupportedMarkdownLanguage,
): Promise<HighlightResult> {
	const cacheKey = `${language}\0${code}`;
	const cached = resultCache.get(cacheKey);
	if (cached) return Promise.resolve(cached);

	const pending = pendingHighlights.get(cacheKey);
	if (pending) return pending;

	const loading = getHighlighter()
		.then(async (highlighter) => {
			await ensureThemes(highlighter);
			await ensureLanguage(highlighter, language);
			const result = highlighter.codeToTokens(code, {
				lang: language,
				themes: {
					dark: DARK_THEME,
					light: LIGHT_THEME,
				},
			});
			return {
				bg: result.bg,
				fg: result.fg,
				rootStyle: result.rootStyle,
				tokens: result.tokens,
			} satisfies HighlightResult;
		})
		.catch((error: unknown) => {
			reportHighlightFailure(language, error);
			return rawHighlight(code);
		})
		.then((result) => {
			cacheResult(cacheKey, result);
			return result;
		})
		.finally(() => {
			pendingHighlights.delete(cacheKey);
		});

	pendingHighlights.set(cacheKey, loading);
	return loading;
}

export const markdownCodeHighlighter = {
	getSupportedLanguages: () => [...SUPPORTED_MARKDOWN_LANGUAGES],
	getThemes: () => [LIGHT_THEME, DARK_THEME],
	highlight: ({ code, language }, callback) => {
		const normalizedLanguage = normalizeLanguage(language);
		if (!normalizedLanguage) return rawHighlight(code);

		const cacheKey = `${normalizedLanguage}\0${code}`;
		const cached = resultCache.get(cacheKey);
		if (cached) return cached;

		const loading = loadHighlight(code, normalizedLanguage);
		if (callback) {
			void loading.then((result) => callback(result));
		}
		return null;
	},
	name: "shiki",
	supportsLanguage: (language) => normalizeLanguage(language) !== null,
	type: "code-highlighter",
} satisfies CodeHighlighterPlugin;
