import { CheckIcon, CopyIcon } from "lucide-react";
import type { ComponentProps, CSSProperties, HTMLAttributes } from "react";
import {
	createContext,
	memo,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	HighlighterCore,
	LanguageRegistration,
	ThemedToken,
	ThemeRegistration,
} from "shiki/core";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// Shiki uses bitflags for font styles: 1=italic, 2=bold, 4=underline
// oxlint-disable-next-line eslint(no-bitwise)
const isItalic = (fontStyle: number | undefined) => fontStyle && fontStyle & 1;
// oxlint-disable-next-line eslint(no-bitwise)
const isBold = (fontStyle: number | undefined) => fontStyle && fontStyle & 2;
const isUnderline = (fontStyle: number | undefined) =>
	// oxlint-disable-next-line eslint(no-bitwise)
	fontStyle && fontStyle & 4;

const SUPPORTED_LANGUAGES = [
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

export type SupportedCodeLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const SUPPORTED_LANGUAGE_SET = new Set<string>(SUPPORTED_LANGUAGES);

const LANGUAGE_LOADERS: Record<
	SupportedCodeLanguage,
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

const LANGUAGE_ALIASES: Record<string, SupportedCodeLanguage> = {
	console: "shellscript",
	cjs: "javascript",
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

const normalizeLanguage = (
	language: string,
): SupportedCodeLanguage | "text" => {
	const normalized = language.trim().toLowerCase();
	if (!normalized) {
		return "text";
	}
	const aliased = LANGUAGE_ALIASES[normalized] ?? normalized;
	return SUPPORTED_LANGUAGE_SET.has(aliased) ? aliased : "text";
};

// Transform tokens to include pre-computed keys to avoid noArrayIndexKey lint
interface KeyedToken {
	token: ThemedToken;
	key: string;
}
interface KeyedLine {
	tokens: KeyedToken[];
	key: string;
}

const addKeysToTokens = (lines: ThemedToken[][]): KeyedLine[] =>
	lines.map((line, lineIdx) => ({
		key: `line-${lineIdx}`,
		tokens: line.map((token, tokenIdx) => ({
			key: `line-${lineIdx}-${tokenIdx}`,
			token,
		})),
	}));

// Token rendering component
const TokenSpan = ({ token }: { token: ThemedToken }) => (
	<span
		className="dark:bg-(--shiki-dark-bg)! dark:text-(--shiki-dark)!"
		style={
			{
				backgroundColor: token.bgColor,
				color: token.color,
				fontStyle: isItalic(token.fontStyle) ? "italic" : undefined,
				fontWeight: isBold(token.fontStyle) ? "bold" : undefined,
				textDecoration: isUnderline(token.fontStyle) ? "underline" : undefined,
				...token.htmlStyle,
			} as CSSProperties
		}
	>
		{token.content}
	</span>
);

// Line number styles using CSS counters
const LINE_NUMBER_CLASSES = cn(
	"block",
	"before:content-[counter(line)]",
	"before:inline-block",
	"before:[counter-increment:line]",
	"before:w-8",
	"before:mr-4",
	"before:text-right",
	"before:text-muted-foreground/50",
	"before:font-mono",
	"before:select-none",
);

// Line rendering component
const LineSpan = ({
	keyedLine,
	showLineNumbers,
}: {
	keyedLine: KeyedLine;
	showLineNumbers: boolean;
}) => (
	<span className={showLineNumbers ? LINE_NUMBER_CLASSES : "block"}>
		{keyedLine.tokens.length === 0
			? "\n"
			: keyedLine.tokens.map(({ token, key }) => (
					<TokenSpan key={key} token={token} />
				))}
	</span>
);

// Types
type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
	code: string;
	language: string;
	showLineNumbers?: boolean;
};

interface TokenizedCode {
	tokens: ThemedToken[][];
	fg: string;
	bg: string;
}

interface CodeBlockContextType {
	code: string;
}

// Context
const CodeBlockContext = createContext<CodeBlockContextType>({
	code: "",
});

// Highlighter cache (singleton per language)
let highlighterPromise: Promise<HighlighterCore> | undefined;
let themesPromise: Promise<void> | undefined;
const languagePromises = new Map<SupportedCodeLanguage, Promise<void>>();

// Token cache
const tokensCache = new Map<string, TokenizedCode>();

// Subscribers for async token updates
const subscribers = new Map<string, Set<(result: TokenizedCode) => void>>();

const getTokensCacheKey = (code: string, language: string) => {
	const start = code.slice(0, 100);
	const end = code.length > 100 ? code.slice(-100) : "";
	return `${language}:${code.length}:${start}:${end}`;
};

const getHighlighter = (): Promise<HighlighterCore> => {
	if (!highlighterPromise) {
		highlighterPromise = createHighlighterCore({
			engine: createJavaScriptRegexEngine({ forgiving: true }),
		});
	}
	return highlighterPromise;
};

const ensureThemes = (highlighter: HighlighterCore): Promise<void> => {
	if (!themesPromise) {
		themesPromise = Promise.all([
			import("@shikijs/themes/github-light").then((module) => module.default),
			import("@shikijs/themes/github-dark").then((module) => module.default),
		]).then((themes: ThemeRegistration[]) => highlighter.loadTheme(...themes));
	}
	return themesPromise;
};

const ensureLanguage = (
	highlighter: HighlighterCore,
	language: SupportedCodeLanguage,
): Promise<void> => {
	const cached = languagePromises.get(language);
	if (cached) {
		return cached;
	}
	const languagePromise = LANGUAGE_LOADERS[language]().then((registrations) =>
		highlighter.loadLanguage(...registrations),
	);
	languagePromises.set(language, languagePromise);
	return languagePromise;
};

// Create raw tokens for immediate display while highlighting loads
const createRawTokens = (code: string): TokenizedCode => ({
	bg: "transparent",
	fg: "inherit",
	tokens: code.split("\n").map((line) =>
		line === ""
			? []
			: [
					{
						color: "inherit",
						content: line,
					} as ThemedToken,
				],
	),
});

// Synchronous highlight with callback for async results
export const highlightCode = (
	code: string,
	language: string,
	// oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-callbacks)
	callback?: (result: TokenizedCode) => void,
): TokenizedCode | null => {
	const langToUse = normalizeLanguage(language);
	if (langToUse === "text") {
		return createRawTokens(code);
	}

	const tokensCacheKey = getTokensCacheKey(code, langToUse);

	// Return cached result if available
	const cached = tokensCache.get(tokensCacheKey);
	if (cached) {
		return cached;
	}

	// Subscribe callback if provided
	if (callback) {
		if (!subscribers.has(tokensCacheKey)) {
			subscribers.set(tokensCacheKey, new Set());
		}
		subscribers.get(tokensCacheKey)?.add(callback);
	}

	// Start highlighting in background - fire-and-forget async pattern
	getHighlighter()
		// oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-then)
		.then(async (highlighter) => {
			await ensureThemes(highlighter);
			await ensureLanguage(highlighter, langToUse);

			const result = highlighter.codeToTokens(code, {
				lang: langToUse,
				themes: {
					dark: "github-dark",
					light: "github-light",
				},
			});

			const tokenized: TokenizedCode = {
				bg: result.bg ?? "transparent",
				fg: result.fg ?? "inherit",
				tokens: result.tokens,
			};

			// Cache the result
			tokensCache.set(tokensCacheKey, tokenized);

			// Notify all subscribers
			const subs = subscribers.get(tokensCacheKey);
			if (subs) {
				for (const sub of subs) {
					sub(tokenized);
				}
				subscribers.delete(tokensCacheKey);
			}
		})
		// oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-then), eslint-plugin-promise(prefer-await-to-callbacks)
		.catch((error) => {
			console.error("Failed to highlight code:", error);
			subscribers.delete(tokensCacheKey);
		});

	return null;
};

const CodeBlockBody = memo(
	({
		tokenized,
		showLineNumbers,
		className,
	}: {
		tokenized: TokenizedCode;
		showLineNumbers: boolean;
		className?: string;
	}) => {
		const preStyle = useMemo(
			() => ({
				backgroundColor: tokenized.bg,
				color: tokenized.fg,
			}),
			[tokenized.bg, tokenized.fg],
		);

		const keyedLines = useMemo(
			() => addKeysToTokens(tokenized.tokens),
			[tokenized.tokens],
		);

		return (
			<pre
				className={cn(
					"dark:bg-(--shiki-dark-bg)! dark:text-(--shiki-dark)! m-0 p-4 text-sm",
					className,
				)}
				style={preStyle}
			>
				<code
					className={cn(
						"font-mono text-sm",
						showLineNumbers &&
							"[counter-increment:line_0] [counter-reset:line]",
					)}
				>
					{keyedLines.map((keyedLine) => (
						<LineSpan
							key={keyedLine.key}
							keyedLine={keyedLine}
							showLineNumbers={showLineNumbers}
						/>
					))}
				</code>
			</pre>
		);
	},
	(prevProps, nextProps) =>
		prevProps.tokenized === nextProps.tokenized &&
		prevProps.showLineNumbers === nextProps.showLineNumbers &&
		prevProps.className === nextProps.className,
);

CodeBlockBody.displayName = "CodeBlockBody";

export const CodeBlockContainer = ({
	className,
	language,
	style,
	...props
}: HTMLAttributes<HTMLDivElement> & { language: string }) => (
	<div
		className={cn(
			"group relative w-full overflow-hidden rounded-sm border bg-background text-foreground",
			className,
		)}
		data-language={language}
		style={{
			containIntrinsicSize: "auto 200px",
			contentVisibility: "auto",
			...style,
		}}
		{...props}
	/>
);

export const CodeBlockHeader = ({
	children,
	className,
	...props
}: HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			"flex items-center justify-between border-b bg-muted/80 px-3 py-2 text-muted-foreground text-xs",
			className,
		)}
		{...props}
	>
		{children}
	</div>
);

export const CodeBlockTitle = ({
	children,
	className,
	...props
}: HTMLAttributes<HTMLDivElement>) => (
	<div className={cn("flex items-center gap-2", className)} {...props}>
		{children}
	</div>
);

export const CodeBlockFilename = ({
	children,
	className,
	...props
}: HTMLAttributes<HTMLSpanElement>) => (
	<span className={cn("font-mono", className)} {...props}>
		{children}
	</span>
);

export const CodeBlockActions = ({
	children,
	className,
	...props
}: HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn("-my-1 -mr-1 flex items-center gap-2", className)}
		{...props}
	>
		{children}
	</div>
);

export const CodeBlockContent = ({
	code,
	language,
	showLineNumbers = false,
}: {
	code: string;
	language: string;
	showLineNumbers?: boolean;
}) => {
	// Memoized raw tokens for immediate display
	const rawTokens = useMemo(() => createRawTokens(code), [code]);

	// Synchronous cache lookup — avoids setState in effect for cached results
	const syncTokens = useMemo(
		() => highlightCode(code, language) ?? rawTokens,
		[code, language, rawTokens],
	);

	// Async highlighting — keyed by identity-stable memo so stale tokens are
	// discarded without reading a ref during render or setState in effect body.
	const asyncKey = useMemo(() => ({ code, language }), [code, language]);
	const [asyncState, setAsyncState] = useState<{
		key: { code: string; language: string };
		tokens: TokenizedCode | null;
	}>({ key: asyncKey, tokens: null });

	const asyncTokens = asyncState.key === asyncKey ? asyncState.tokens : null;

	useEffect(() => {
		let cancelled = false;

		highlightCode(code, language, (result) => {
			if (!cancelled) {
				setAsyncState({ key: asyncKey, tokens: result });
			}
		});

		return () => {
			cancelled = true;
		};
	}, [code, language, asyncKey]);

	const tokenized = asyncTokens ?? syncTokens;

	return (
		<div className="relative overflow-auto">
			<CodeBlockBody showLineNumbers={showLineNumbers} tokenized={tokenized} />
		</div>
	);
};

export const CodeBlock = ({
	code,
	language,
	showLineNumbers = false,
	className,
	children,
	...props
}: CodeBlockProps) => {
	const contextValue = useMemo(() => ({ code }), [code]);

	return (
		<CodeBlockContext.Provider value={contextValue}>
			<CodeBlockContainer className={className} language={language} {...props}>
				{children}
				<CodeBlockContent
					code={code}
					language={language}
					showLineNumbers={showLineNumbers}
				/>
			</CodeBlockContainer>
		</CodeBlockContext.Provider>
	);
};

export type CodeBlockCopyButtonProps = ComponentProps<typeof Button> & {
	onCopy?: () => void;
	onError?: (error: Error) => void;
	timeout?: number;
};

export const CodeBlockCopyButton = ({
	onCopy,
	onError,
	timeout = 2000,
	children,
	className,
	...props
}: CodeBlockCopyButtonProps) => {
	const [isCopied, setIsCopied] = useState(false);
	const timeoutRef = useRef<number>(0);
	const { code } = useContext(CodeBlockContext);

	const copyToClipboard = useCallback(async () => {
		if (typeof window === "undefined" || !navigator?.clipboard?.writeText) {
			onError?.(new Error("Clipboard API not available"));
			return;
		}

		try {
			if (!isCopied) {
				await navigator.clipboard.writeText(code);
				setIsCopied(true);
				onCopy?.();
				timeoutRef.current = window.setTimeout(
					() => setIsCopied(false),
					timeout,
				);
			}
		} catch (error) {
			onError?.(error as Error);
		}
	}, [code, onCopy, onError, timeout, isCopied]);

	useEffect(
		() => () => {
			window.clearTimeout(timeoutRef.current);
		},
		[],
	);

	const Icon = isCopied ? CheckIcon : CopyIcon;

	return (
		<Button
			className={cn("shrink-0", className)}
			onClick={copyToClipboard}
			size="icon"
			variant="ghost"
			{...props}
		>
			{children ?? <Icon size={14} />}
		</Button>
	);
};

export type CodeBlockLanguageSelectorProps = ComponentProps<typeof Select>;

export const CodeBlockLanguageSelector = (
	props: CodeBlockLanguageSelectorProps,
) => <Select {...props} />;

export type CodeBlockLanguageSelectorTriggerProps = ComponentProps<
	typeof SelectTrigger
>;

export const CodeBlockLanguageSelectorTrigger = ({
	className,
	...props
}: CodeBlockLanguageSelectorTriggerProps) => (
	<SelectTrigger
		className={cn(
			"h-7 border-none bg-transparent px-2 text-xs shadow-none",
			className,
		)}
		size="sm"
		{...props}
	/>
);

export type CodeBlockLanguageSelectorValueProps = ComponentProps<
	typeof SelectValue
>;

export const CodeBlockLanguageSelectorValue = (
	props: CodeBlockLanguageSelectorValueProps,
) => <SelectValue {...props} />;

export type CodeBlockLanguageSelectorContentProps = ComponentProps<
	typeof SelectContent
>;

export const CodeBlockLanguageSelectorContent = ({
	align = "end",
	...props
}: CodeBlockLanguageSelectorContentProps) => (
	<SelectContent align={align} {...props} />
);

export type CodeBlockLanguageSelectorItemProps = ComponentProps<
	typeof SelectItem
>;

export const CodeBlockLanguageSelectorItem = (
	props: CodeBlockLanguageSelectorItemProps,
) => <SelectItem {...props} />;
