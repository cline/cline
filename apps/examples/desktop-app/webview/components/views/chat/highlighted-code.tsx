"use client";

import { markdownCodeHighlighter } from "@cline/ui/components/markdown";
import { parseDiffFromFile } from "@pierre/diffs";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

// File and diff views for the workspace panel. They use the same shiki
// highlighter as chat code blocks (forgiving JS regex engine, github themes)
// so highlighting behaves identically in every webview the app ships in.

type Token = {
	content: string;
	color?: string;
	htmlStyle?: Record<string, string>;
};
type Lines = Token[][];

// Beyond this the file renders plain: tokenizing megabytes on the main
// thread would stall the panel for little benefit.
const HIGHLIGHT_LIMIT_CHARS = 300_000;
const DIFF_CONTEXT_LINES = 3;

const EXTENSION_LANGUAGES: Record<string, string> = {
	cts: "typescript",
	mts: "typescript",
	bash: "bash",
	zsh: "shellscript",
	jsonc: "jsonc",
	json5: "jsonc",
	htm: "html",
	mdx: "markdown",
	yaml: "yaml",
};

export function languageForPath(path: string): string {
	const name = path.split(/[\\/]/).pop() ?? path;
	if (/^\.?(bash|zsh)rc$/.test(name) || name === ".profile") {
		return "shellscript";
	}
	const extension = name.includes(".")
		? (name.split(".").pop() ?? "").toLowerCase()
		: "";
	return Object.hasOwn(EXTENSION_LANGUAGES, extension)
		? (EXTENSION_LANGUAGES[extension] ?? extension)
		: extension;
}

function splitLines(text: string): string[] {
	if (!text) return [];
	const lines = text.split("\n");
	if (lines.at(-1) === "") lines.pop();
	return lines;
}

function plainLines(text: string): Lines {
	return splitLines(text).map((line) => (line ? [{ content: line }] : []));
}

// Lines tokenized before a slice, so state such as an open comment or
// template string carries into it.
const LEAD_IN_LINES = 40;
// A file's head is highlighted on its own first so the visible part colors
// right away; tokenizing a large file in one pass takes seconds in WebKit.
const FILE_HEAD_LINES = 300;

type LineRange = readonly [start: number, end: number];

const EMPTY_LINES = new Map<number, Token[]>();

/**
 * Highlighted tokens for the given line ranges, keyed by line index. Lines
 * without an entry render plain until (or unless) shiki answers.
 */
function useHighlightedRanges(
	text: string,
	path: string,
	ranges: readonly LineRange[],
): Map<number, Token[]> {
	const language = languageForPath(path);
	const rangesKey = ranges.map(([start, end]) => `${start}-${end}`).join(",");
	const key = `${language}\0${rangesKey}\0${text}`;
	const [result, setResult] = useState<{
		key: string;
		lines: Map<number, Token[]>;
	} | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: key captures text, language, and ranges
	useEffect(() => {
		if (!text || ranges.length === 0) return;
		if (!markdownCodeHighlighter.supportsLanguage(language as never)) return;
		const lines = splitLines(text);
		let cancelled = false;
		const collected = new Map<number, Token[]>();
		for (const [start, end] of ranges) {
			const from = Math.max(0, start - LEAD_IN_LINES);
			const to = Math.min(lines.length, end);
			if (to <= start) continue;
			const code = lines.slice(from, to).join("\n");
			if (code.length > HIGHLIGHT_LIMIT_CHARS) continue;
			const apply = (highlighted: { tokens: unknown }) => {
				if (cancelled) return;
				const tokens = highlighted.tokens as Lines;
				for (let index = start; index < to; index++) {
					const line = tokens[index - from];
					if (line) collected.set(index, line);
				}
				setResult({ key, lines: new Map(collected) });
			};
			const sync = markdownCodeHighlighter.highlight(
				{
					code,
					language: language as never,
					themes: markdownCodeHighlighter.getThemes(),
				},
				apply,
			);
			if (sync) apply(sync);
		}
		return () => {
			cancelled = true;
		};
	}, [key]);
	return result?.key === key ? result.lines : EMPTY_LINES;
}

function TokenSpans({ tokens }: { tokens: Token[] | undefined }) {
	if (!tokens || tokens.length === 0) return <>{"\u200b"}</>;
	return (
		<>
			{tokens.map((token, index) => {
				const style: Record<string, string> = {};
				if (token.color) style["--sdm-c"] = token.color;
				for (const [key, value] of Object.entries(token.htmlStyle ?? {})) {
					if (key === "color") style["--sdm-c"] = value;
					else if (key !== "background-color") style[key] = value;
				}
				return (
					<span
						className="text-[var(--sdm-c,inherit)] dark:text-[var(--shiki-dark,var(--sdm-c,inherit))]"
						// biome-ignore lint/suspicious/noArrayIndexKey: tokens never reorder within a line
						key={index}
						style={style as CSSProperties}
					>
						{token.content}
					</span>
				);
			})}
		</>
	);
}

const ROW = "flex font-mono text-xs leading-5";
const GUTTER =
	"shrink-0 select-none pr-3 text-right text-muted-foreground/60 tabular-nums";
// Wrapped continuations hang 2ch in so they don't read as new lines;
// `hanging` (unlike padding plus a negative indent) keeps the first line's
// tab stops where they were.
const CODE =
	"min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere pr-4 [text-indent:2ch_hanging]";

export function CodeFile({
	path,
	contents,
}: {
	path: string;
	contents: string;
}) {
	const lines = useMemo(() => plainLines(contents), [contents]);
	const head = useHighlightedRanges(contents, path, [
		[0, Math.min(lines.length, FILE_HEAD_LINES)],
	]);
	const full = useHighlightedRanges(
		contents,
		path,
		lines.length > FILE_HEAD_LINES ? [[0, lines.length]] : [],
	);
	const gutterWidth = `${String(lines.length).length + 2}ch`;
	return (
		<div
			className="cline-chat-selectable bg-background py-2"
			data-testid="file-contents"
		>
			{lines.map((tokens, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: line positions are the identity
				<div className={ROW} key={index}>
					<span className={GUTTER} style={{ width: gutterWidth }}>
						{index + 1}
					</span>
					<span className={CODE}>
						<TokenSpans tokens={full.get(index) ?? head.get(index) ?? tokens} />
					</span>
				</div>
			))}
		</div>
	);
}

type DiffLine = {
	kind: "context" | "addition" | "deletion";
	oldIndex: number | null;
	newIndex: number | null;
};
type DiffRow = DiffLine | { kind: "gap"; hidden: number };

function buildRows(
	oldText: string | undefined,
	newText: string,
	path: string,
): DiffRow[] {
	let diff: ReturnType<typeof parseDiffFromFile>;
	try {
		diff = parseDiffFromFile(
			oldText !== undefined ? { name: path, contents: oldText } : null,
			{ name: path, contents: newText },
			{ context: DIFF_CONTEXT_LINES },
		);
	} catch {
		return [];
	}
	const rows: DiffRow[] = [];
	for (const hunk of diff.hunks) {
		if (hunk.collapsedBefore > 0) {
			rows.push({ kind: "gap", hidden: hunk.collapsedBefore });
		}
		for (const block of hunk.hunkContent) {
			if (block.type === "context") {
				for (let offset = 0; offset < block.lines; offset++) {
					const oldIndex = block.deletionLineIndex + offset;
					const newIndex = block.additionLineIndex + offset;
					rows.push({ kind: "context", oldIndex, newIndex });
				}
				continue;
			}
			for (let offset = 0; offset < block.deletions; offset++) {
				const index = block.deletionLineIndex + offset;
				rows.push({ kind: "deletion", oldIndex: index, newIndex: null });
			}
			for (let offset = 0; offset < block.additions; offset++) {
				const index = block.additionLineIndex + offset;
				rows.push({ kind: "addition", oldIndex: null, newIndex: index });
			}
		}
	}
	const last = diff.hunks.at(-1);
	if (last) {
		const shown = last.additionLineIndex + last.additionCount;
		const trailing = splitLines(newText).length - shown;
		if (trailing > 0) rows.push({ kind: "gap", hidden: trailing });
	}
	return rows;
}

/** Contiguous runs of line indexes, so each hunk is highlighted as one slice. */
function rangesOf(indexes: number[]): LineRange[] {
	const ranges: Array<[number, number]> = [];
	for (const index of indexes) {
		const last = ranges.at(-1);
		if (last && index <= last[1]) last[1] = Math.max(last[1], index + 1);
		else ranges.push([index, index + 1]);
	}
	return ranges;
}

/** Unified diff of a file's old and new contents; `oldText` absent = added. */
export function CodeDiff({
	path,
	oldText,
	newText,
	fragment = false,
}: {
	path: string;
	oldText?: string;
	newText: string;
	/**
	 * Both sides are excerpts (session edit hunks), so line numbers would
	 * misleadingly start at 1 and are hidden.
	 */
	fragment?: boolean;
}) {
	const rows = useMemo(() => {
		const all = buildRows(oldText, newText, path);
		return fragment ? all.filter((row) => row.kind !== "gap") : all;
	}, [fragment, newText, oldText, path]);
	const { oldRanges, newRanges } = useMemo(() => {
		const oldIndexes: number[] = [];
		const newIndexes: number[] = [];
		for (const row of rows) {
			if (row.kind === "gap") continue;
			// Context renders from the new side, so only deletions need the old.
			if (row.kind === "deletion" && row.oldIndex !== null) {
				oldIndexes.push(row.oldIndex);
			}
			if (row.newIndex !== null) newIndexes.push(row.newIndex);
		}
		return {
			oldRanges: rangesOf(oldIndexes),
			newRanges: rangesOf(newIndexes),
		};
	}, [rows]);
	const oldTokens = useHighlightedRanges(oldText ?? "", path, oldRanges);
	const newTokens = useHighlightedRanges(newText, path, newRanges);
	const oldPlain = useMemo(() => plainLines(oldText ?? ""), [oldText]);
	const newPlain = useMemo(() => plainLines(newText), [newText]);
	if (rows.length === 0) {
		return (
			<div className="p-4 text-xs text-muted-foreground">
				No textual changes.
			</div>
		);
	}
	const digits = String(
		Math.max(splitLines(oldText ?? "").length, splitLines(newText).length),
	).length;
	const numberWidth = `${digits + 1}ch`;
	return (
		<div
			className="cline-chat-selectable bg-background py-2"
			data-testid="file-diff"
		>
			{rows.map((row, index) =>
				row.kind === "gap" ? (
					<div
						className="my-1 flex items-center bg-muted/50 px-3 py-0.5 font-mono text-[11px] text-muted-foreground"
						// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
						key={index}
					>
						⋯ {row.hidden} unchanged line{row.hidden === 1 ? "" : "s"}
					</div>
				) : (
					<div
						className={cn(
							ROW,
							row.kind === "addition" && "bg-chart-2/12",
							row.kind === "deletion" && "bg-destructive/12",
						)}
						// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
						key={index}
					>
						<span className="flex shrink-0 select-none tabular-nums text-muted-foreground/60">
							{fragment ? null : (
								<>
									<span
										className="pr-2 text-right"
										style={{ width: numberWidth }}
									>
										{row.oldIndex === null ? "" : row.oldIndex + 1}
									</span>
									<span
										className="pr-2 text-right"
										style={{ width: numberWidth }}
									>
										{row.newIndex === null ? "" : row.newIndex + 1}
									</span>
								</>
							)}
							<span
								className={cn(
									"w-4 text-center",
									row.kind === "addition" && "text-chart-2",
									row.kind === "deletion" && "text-destructive",
								)}
							>
								{row.kind === "addition"
									? "+"
									: row.kind === "deletion"
										? "-"
										: ""}
							</span>
						</span>
						<span className={CODE}>
							<TokenSpans
								tokens={
									row.kind === "deletion" && row.oldIndex !== null
										? (oldTokens.get(row.oldIndex) ?? oldPlain[row.oldIndex])
										: row.newIndex !== null
											? (newTokens.get(row.newIndex) ?? newPlain[row.newIndex])
											: undefined
								}
							/>
						</span>
					</div>
				),
			)}
		</div>
	);
}
