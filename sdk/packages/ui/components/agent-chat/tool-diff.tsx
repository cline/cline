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
import { type CSSProperties, useMemo } from "react";

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
// markers — meaningless noise for chat rows.
function ensureTrailingNewline(text: string): string {
	return text.endsWith("\n") ? text : `${text}\n`;
}

export function ToolFileDiff({
	background = "var(--background, light-dark(#fff, #000))",
	className,
	fragment = false,
	newText,
	oldText,
	options,
	path,
}: ToolFileDiffProps) {
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

	if (!fileDiff) return null;
	return (
		<FileDiff
			className={className}
			fileDiff={fileDiff}
			options={resolvedOptions}
			style={
				{
					"--diffs-light-bg": background,
					"--diffs-dark-bg": background,
				} as CSSProperties
			}
		/>
	);
}
