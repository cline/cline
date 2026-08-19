"use client";

/**
 * Rich diff rendering for tool-call rows, backed by @pierre/diffs
 * (https://github.com/pierrecomputer/pierre). Pairs with the tool-summary
 * module: feed a file item's `path`/`oldText`/`newText`/`fragment` straight
 * in and every product renders the same syntax-highlighted, theme-aware diff.
 *
 * @pierre/diffs is an optional peer dependency — only consumers importing
 * this subpath need to install it.
 */

import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff, type FileDiffProps } from "@pierre/diffs/react";
import {
	type CSSProperties,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

type DiffOptions = NonNullable<FileDiffProps<undefined>["options"]>;

export type ToolFileDiffProps = {
	/** File path; used for the header-less language inference. */
	path: string;
	/** Contents after the change. */
	newText: string;
	/** Contents before the change; omit for created files. */
	oldText?: string;
	/**
	 * Set when oldText/newText are fragments of the file (editor str_replace
	 * payloads, apply_patch update sections) rather than complete contents.
	 * Fragments hide line numbers, which would otherwise misleadingly start
	 * at 1.
	 */
	fragment?: boolean;
	className?: string;
	/**
	 * CSS color (or var()) the diff surface uses as its base background; all
	 * of @pierre/diffs' derived tints (context lines, gutters, separators)
	 * are color-mixed from it. Defaults to the host app's `--background`
	 * token so diffs sit on the app surface instead of pierre's pure
	 * white/black theme background.
	 */
	background?: string;
	/** Merged over the defaults for per-product tuning. */
	options?: DiffOptions;
};

const BASE_OPTIONS: DiffOptions = {
	diffStyle: "unified",
	disableFileHeader: true,
	themeType: "system",
};

// Tool payloads carry code fragments that rarely end in a newline, which
// would otherwise litter every diff with "No newline at end of file"
// markers — meaningless noise for chat rows. Empty text stays empty so an
// empty side diffs as zero lines rather than one blank line.
function ensureTrailingNewline(text: string): string {
	if (!text) return "";
	return text.endsWith("\n") ? text : `${text}\n`;
}

// A freshly mounted FileDiff can end up permanently blank: React StrictMode
// double-invokes the wrapper's ref, the first (immediately cleaned up)
// instance leaves a half-rendered shadow tree behind — its async highlight
// work aborts on cleanup — and the second instance adopts that skeleton as if
// it were complete prerendered output, never rendering the code or attaching
// its theme stylesheet. A rendered diff always carries `style[data-theme-css]`
// in the shadow root; when it is missing after the async window, remounting
// FileDiff (fresh host element, fresh render path) recovers reliably.
const RENDER_CHECK_DELAY_MS = 400;
const MAX_RENDER_ATTEMPTS = 3;

export function ToolFileDiff({
	background = "var(--background, light-dark(#fff, #000))",
	className,
	fragment = false,
	newText,
	oldText,
	options,
	path,
}: ToolFileDiffProps) {
	const hostRef = useRef<HTMLSpanElement | null>(null);
	const [renderAttempt, setRenderAttempt] = useState(0);
	const fileDiff = useMemo(() => {
		try {
			return parseDiffFromFile(
				oldText !== undefined
					? { contents: ensureTrailingNewline(oldText), name: path }
					: null,
				{ contents: ensureTrailingNewline(newText), name: path },
			);
		} catch {
			// Unparsable or identical contents — the row's +/- badge and
			// detail lines still describe the change.
			return null;
		}
	}, [oldText, newText, path]);
	const resolvedOptions = useMemo(
		() => ({
			...BASE_OPTIONS,
			...(fragment ? { disableLineNumbers: true } : {}),
			...options,
		}),
		[fragment, options],
	);

	useEffect(() => {
		if (!fileDiff || renderAttempt >= MAX_RENDER_ATTEMPTS) return;
		const timer = window.setTimeout(() => {
			const container = hostRef.current?.firstElementChild;
			if (!container) return;
			const themed = container.shadowRoot?.querySelector(
				"style[data-theme-css]",
			);
			if (!themed) setRenderAttempt((attempt) => attempt + 1);
		}, RENDER_CHECK_DELAY_MS);
		return () => window.clearTimeout(timer);
	}, [fileDiff, renderAttempt]);

	if (!fileDiff) return null;
	return (
		<span ref={hostRef} style={{ display: "contents" }}>
			<FileDiff
				className={className}
				fileDiff={fileDiff}
				key={renderAttempt}
				options={resolvedOptions}
				style={
					{
						"--diffs-light-bg": background,
						"--diffs-dark-bg": background,
						// @pierre/diffs declares `color-scheme: light dark` on its
						// shadow :host, so its light-dark() token colors follow the
						// browser's preferred scheme — not the host app's
						// class-based theme — leaving e.g. near-black light-palette
						// text on a dark app surface. Inheriting the app's
						// color-scheme (flipped by `.dark` in the @cline/ui theme)
						// keeps the syntax palette in lockstep with the app theme.
						// Skipped when a caller pins an explicit themeType, which
						// pierre implements as its own :host color-scheme rule.
						...(resolvedOptions.themeType === "system" ||
						resolvedOptions.themeType === undefined
							? { colorScheme: "inherit" }
							: {}),
					} as CSSProperties
				}
			/>
		</span>
	);
}
