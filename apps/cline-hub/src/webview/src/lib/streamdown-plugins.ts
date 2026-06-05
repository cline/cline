import { cjk } from "@streamdown/cjk";
import { math } from "@streamdown/math";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import {
	type BundledLanguage,
	bundledLanguages,
	bundledLanguagesInfo,
} from "shiki/langs";
import type {
	CodeHighlighterPlugin,
	DiagramPlugin,
	PluginConfig,
	ThemeInput,
} from "streamdown";

interface HighlightResult {
	bg?: string;
	fg?: string;
	rootStyle?: string | false;
	tokens: {
		bgColor?: string;
		color?: string;
		content: string;
		htmlAttrs?: Record<string, string>;
		htmlStyle?: Record<string, string>;
		offset?: number;
	}[][];
}

const supportedLanguages = Object.keys(bundledLanguages) as BundledLanguage[];
const languageAliases = new Map<string, BundledLanguage>(
	bundledLanguagesInfo.flatMap((language) =>
		(language.aliases ?? []).map((alias) => [
			alias,
			language.id as BundledLanguage,
		]),
	),
);
const supportedLanguageSet = new Set<string>(supportedLanguages);
const defaultThemes = ["github-light", "github-dark"] as [
	ThemeInput,
	ThemeInput,
];

const highlighterCache = new Map<string, Promise<HighlighterCore>>();
const tokenCache = new Map<string, HighlightResult>();
const subscribers = new Map<string, Set<(result: HighlightResult) => void>>();

const normalizeLanguage = (language: string): BundledLanguage | null => {
	const normalized = language.trim().toLowerCase();
	if (supportedLanguageSet.has(normalized)) {
		return normalized as BundledLanguage;
	}

	return languageAliases.get(normalized) ?? null;
};

const getThemeName = (theme: ThemeInput) =>
	typeof theme === "string" ? theme : theme.name;

const getCacheKey = (
	code: string,
	language: BundledLanguage,
	themes: [ThemeInput, ThemeInput],
) => {
	const start = code.slice(0, 100);
	const end = code.length > 100 ? code.slice(-100) : "";
	return `${language}:${getThemeName(themes[0])}:${getThemeName(themes[1])}:${code.length}:${start}:${end}`;
};

const getHighlighter = (language: BundledLanguage) => {
	const cached = highlighterCache.get(language);
	if (cached) {
		return cached;
	}

	const highlighter = createHighlighterCore({
		engine: createJavaScriptRegexEngine({ forgiving: true }),
		langs: [bundledLanguages[language]],
		themes: [
			() => import("shiki/dist/themes/github-light.mjs"),
			() => import("shiki/dist/themes/github-dark.mjs"),
		],
	});

	highlighterCache.set(language, highlighter);
	return highlighter;
};

const createPlainResult = (code: string): HighlightResult => ({
	bg: "transparent",
	fg: "inherit",
	tokens: code
		.split("\n")
		.map((line) => (line === "" ? [] : [{ color: "inherit", content: line }])),
});

const code: CodeHighlighterPlugin = {
	getSupportedLanguages: () => [...supportedLanguages],
	getThemes: () => defaultThemes,
	highlight: ({ code: source, language, themes }, callback) => {
		const normalizedLanguage = normalizeLanguage(language);
		if (!normalizedLanguage) {
			return createPlainResult(source);
		}

		const cacheKey = getCacheKey(source, normalizedLanguage, themes);
		const cached = tokenCache.get(cacheKey);
		if (cached) {
			return cached;
		}

		if (callback) {
			if (!subscribers.has(cacheKey)) {
				subscribers.set(cacheKey, new Set());
			}
			subscribers.get(cacheKey)?.add(callback);
		}

		getHighlighter(normalizedLanguage)
			.then((highlighter) => {
				const lightTheme = getThemeName(themes[0]);
				const darkTheme = getThemeName(themes[1]);
				const result = highlighter.codeToTokens(source, {
					lang: normalizedLanguage,
					themes: {
						dark: darkTheme,
						light: lightTheme,
					},
				});

				tokenCache.set(cacheKey, result);

				const cacheSubscribers = subscribers.get(cacheKey);
				if (cacheSubscribers) {
					for (const subscriber of cacheSubscribers) {
						subscriber(result);
					}
					subscribers.delete(cacheKey);
				}
			})
			.catch((error) => {
				console.error("[Streamdown Code] Failed to highlight code:", error);
				subscribers.delete(cacheKey);
			});

		return null;
	},
	name: "shiki",
	supportsLanguage: (language) => normalizeLanguage(language) !== null,
	type: "code-highlighter",
};

type MermaidConfig = NonNullable<Parameters<DiagramPlugin["getMermaid"]>[0]>;
type MermaidModule = typeof import("@streamdown/mermaid");

const defaultMermaidConfig = {
	fontFamily: "monospace",
	securityLevel: "strict",
	startOnLoad: false,
	suppressErrorRendering: true,
	theme: "default",
} satisfies MermaidConfig;

let mermaidModulePromise: Promise<MermaidModule> | null = null;
let mermaidConfig: MermaidConfig = defaultMermaidConfig;
let pendingMermaidInitialize = true;

const getMermaidModule = () => {
	if (!mermaidModulePromise) {
		mermaidModulePromise = import("@streamdown/mermaid");
	}
	return mermaidModulePromise;
};

const lazyMermaid: DiagramPlugin = {
	getMermaid: (config) => {
		if (config) {
			mermaidConfig = {
				...defaultMermaidConfig,
				...mermaidConfig,
				...config,
			};
			pendingMermaidInitialize = true;
		}

		return {
			initialize: (nextConfig) => {
				mermaidConfig = {
					...defaultMermaidConfig,
					...nextConfig,
				};
				pendingMermaidInitialize = true;
				void getMermaidModule().then(({ mermaid }) => {
					mermaid.getMermaid().initialize(mermaidConfig);
					pendingMermaidInitialize = false;
				});
			},
			render: async (id, source) => {
				const { mermaid } = await getMermaidModule();
				const mermaidInstance = mermaid.getMermaid();
				if (pendingMermaidInitialize) {
					mermaidInstance.initialize(mermaidConfig);
					pendingMermaidInitialize = false;
				}
				return mermaidInstance.render(id, source);
			},
		};
	},
	language: "mermaid",
	name: "mermaid",
	type: "diagram",
};

export const streamdownPlugins = {
	cjk,
	code,
	math,
	mermaid: lazyMermaid,
} satisfies PluginConfig;
