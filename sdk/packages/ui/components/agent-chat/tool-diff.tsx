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
import { useMemo } from "react";

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
	/** Merged over the defaults for per-product tuning. */
	options?: DiffOptions;
};

const BASE_OPTIONS: DiffOptions = {
	diffStyle: "unified",
	disableFileHeader: true,
	themeType: "system",
};

export function ToolFileDiff({
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
				oldText !== undefined ? { contents: oldText, name: path } : null,
				{ contents: newText, name: path },
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
		/>
	);
}
