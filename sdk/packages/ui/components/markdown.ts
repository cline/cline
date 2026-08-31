import type { MermaidConfig } from "mermaid";
import type {
	HighlighterCore,
	LanguageRegistration,
	ThemeRegistration,
} from "shiki/core";
import type {
	CodeHighlighterPlugin,
	ControlsConfig,
	DiagramPlugin,
} from "streamdown";

/**
 * Shared Streamdown configuration for agent chat Markdown, so every product
 * renders assistant prose the same way. Products keep their own Streamdown
 * wrapper (link policy, image policy, extra plugins) and pass these in:
 *
 *   <Streamdown
 *     className="cline-markdown"
 *     controls={agentMarkdownControls}
 *     plugins={{ code: markdownCodeHighlighter }}
 *   >
 *
 * Pair with `@cline/ui/components/markdown.css` for the matching visual
 * treatment (single quiet code blocks with a hover copy control, chat-scale
 * headings, table cards).
 *
 * Runtime requirements (optional peer dependencies): `streamdown`, `shiki`,
 * `@shikijs/langs`, and `@shikijs/themes`.
 */

type HighlightResult = NonNullable<
	ReturnType<CodeHighlighterPlugin["highlight"]>
>;

/** Copy on code blocks; no downloads; no mermaid/table chrome. The matching
 * CSS hides the code-block header and reveals the copy control on hover. */
export const agentMarkdownControls = {
	code: { copy: true, download: false },
	mermaid: false,
	table: false,
} satisfies ControlsConfig;

/** Desktop/host opt-in controls for interactive Mermaid diagrams. The default
 * controls above stay diagram-free so existing consumers don't change unless
 * they also register a Mermaid DiagramPlugin. */
export const agentMarkdownControlsWithMermaid = {
	...agentMarkdownControls,
	mermaid: {
		copy: true,
		download: true,
		fullscreen: true,
		panZoom: true,
	},
} satisfies ControlsConfig;

const DEFAULT_MERMAID_CONFIG = {
	fontFamily: "monospace",
	securityLevel: "strict",
	startOnLoad: false,
	suppressErrorRendering: true,
	theme: "default",
} satisfies MermaidConfig;

interface LazyMermaidInstance {
	initialize: (config: MermaidConfig) => void;
	render: (id: string, source: string) => Promise<{ svg: string }>;
}

type MermaidModule = {
	default: LazyMermaidInstance;
};

export type MermaidModuleLoader = () => Promise<MermaidModule>;

const loadMermaid: MermaidModuleLoader = () => import("mermaid");

/**
 * Carries a diagram link's original destination once the navigable href has
 * been removed, so hosts can offer their own vetted way to open it.
 */
export const DIAGRAM_LINK_HREF_ATTRIBUTE = "data-cline-diagram-href";

/** Attributes that would let an anchor navigate on its own. */
const NAVIGABLE_LINK_ATTRIBUTES = ["href", "xlink:href"] as const;

function openableHref(value: string): string | null {
	try {
		const parsed = new URL(value.trim());
		return parsed.protocol === "http:" || parsed.protocol === "https:"
			? parsed.href
			: null;
	} catch {
		return null;
	}
}

function neutralizeWithDom(svg: string): string | null {
	if (
		typeof DOMParser === "undefined" ||
		typeof XMLSerializer === "undefined"
	) {
		return null;
	}
	try {
		const document = new DOMParser().parseFromString(svg, "image/svg+xml");
		if (document.getElementsByTagName("parsererror").length > 0) return null;

		for (const anchor of Array.from(document.getElementsByTagName("a"))) {
			const destination = NAVIGABLE_LINK_ATTRIBUTES.map((attribute) =>
				anchor.getAttribute(attribute),
			).find((value): value is string => Boolean(value));

			for (const attribute of NAVIGABLE_LINK_ATTRIBUTES) {
				anchor.removeAttribute(attribute);
			}
			// `target` alone cannot navigate, but leaving it invites a future
			// re-add of href to open in a new context without host review.
			anchor.removeAttribute("target");

			const openable = destination ? openableHref(destination) : null;
			if (openable) anchor.setAttribute(DIAGRAM_LINK_HREF_ATTRIBUTE, openable);
		}

		return new XMLSerializer().serializeToString(document.documentElement);
	} catch {
		return null;
	}
}

const ANCHOR_OPEN_TAG_PATTERN = /<a\b[^>]*>/gi;
const LINK_ATTRIBUTE_PATTERN =
	/\s(?:xlink:href|href|target)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

function neutralizeWithPatterns(svg: string): string {
	return svg.replace(ANCHOR_OPEN_TAG_PATTERN, (openTag) => {
		let destination: string | null = null;
		const stripped = openTag.replace(
			LINK_ATTRIBUTE_PATTERN,
			(match, doubleQuoted?: string, singleQuoted?: string) => {
				if (!/\starget\s*=/i.test(match)) {
					destination ??= doubleQuoted ?? singleQuoted ?? null;
				}
				return "";
			},
		);
		const openable = destination ? openableHref(destination) : null;
		if (!openable) return stripped;
		return stripped.replace(
			/\s*\/?>$/,
			(tail) =>
				` ${DIAGRAM_LINK_HREF_ATTRIBUTE}="${openable.replace(/"/g, "&quot;")}"${tail}`,
		);
	});
}

/**
 * Mermaid's `securityLevel: "strict"` blocks script execution and dangerous URL
 * schemes, but still renders `click <node> "https://…"` directives as live
 * `<a xlink:href>` anchors inside the SVG. Streamdown injects that SVG with
 * `dangerouslySetInnerHTML`, so those anchors never pass through a product's
 * React link component — bypassing whatever link policy the host applies to
 * ordinary Markdown links (confirmation prompts, external-open routing), and in
 * a desktop webview letting a click navigate the app away from itself.
 *
 * A diagram label is authored independently of its destination, so these links
 * are deceptive by construction. Strip the navigable attributes so a diagram
 * link cannot navigate on its own, and preserve an http(s) destination in
 * `DIAGRAM_LINK_HREF_ATTRIBUTE` so hosts can opt into opening it deliberately.
 */
export function neutralizeDiagramLinks(svg: string): string {
	if (!svg.includes("<a")) return svg;
	return neutralizeWithDom(svg) ?? neutralizeWithPatterns(svg);
}

/**
 * Creates a Streamdown Mermaid plugin with host-local loading and config state.
 * The renderer is loaded only after a `mermaid` fence is encountered.
 */
export function createLazyMermaidPlugin(
	loader: MermaidModuleLoader = loadMermaid,
): DiagramPlugin {
	let config: MermaidConfig = DEFAULT_MERMAID_CONFIG;
	let modulePromise: Promise<MermaidModule> | undefined;
	const getModule = () => {
		modulePromise ??= loader().catch((error: unknown) => {
			modulePromise = undefined;
			throw error;
		});
		return modulePromise;
	};

	let initialized = false;

	const instance: LazyMermaidInstance = {
		initialize(nextConfig: MermaidConfig) {
			config = {
				...DEFAULT_MERMAID_CONFIG,
				...config,
				...nextConfig,
				securityLevel: "strict",
			};
			initialized = false;
		},
		async render(id: string, source: string) {
			const mermaidModule = await getModule();
			const mermaid = mermaidModule.default;
			if (!initialized) {
				mermaid.initialize(config);
				initialized = true;
			}
			const result = await mermaid.render(id, source);
			return { ...result, svg: neutralizeDiagramLinks(result.svg) };
		},
	};

	return {
		getMermaid(nextConfig?: MermaidConfig) {
			if (nextConfig) instance.initialize(nextConfig);
			return instance;
		},
		language: "mermaid",
		name: "mermaid",
		type: "diagram",
	};
}

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

// Annotated (not `satisfies`) so the emitted declaration names the public
// CodeHighlighterPlugin type instead of streamdown's unexported internals.
export const markdownCodeHighlighter: CodeHighlighterPlugin = {
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
};
