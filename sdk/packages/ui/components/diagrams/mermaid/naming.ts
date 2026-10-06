/**
 * Naming primitives for the owned Mermaid diagram block: fence-title parsing,
 * slug construction, frontmatter splitting and download filenames. Pure and
 * DOM-free so it can be unit-tested in Node. The public entry point stays
 * `mermaid-diagram.ts`; the React block lives in `mermaid-block.tsx`.
 */

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

export const DEFAULT_DIAGRAM_NAME = "diagram";
export const MAX_DIAGRAM_SLUG_LENGTH = 64;

/** Lowercase, alphanumerics and single hyphens, trimmed, length-capped. */
export function slugifyDiagramName(
	value: string,
	maxLength: number = MAX_DIAGRAM_SLUG_LENGTH,
): string {
	const slug = value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (slug.length <= maxLength) return slug;
	return slug.slice(0, maxLength).replace(/-+$/g, "");
}

/**
 * Reads `title="..."` from a code-fence metastring. Tolerates single quotes,
 * curly quotes, an unquoted value, `title:` instead of `title=`, and a missing
 * closing quote. `meta` is often undefined or empty (including while
 * streaming), which yields `undefined`.
 */
export function parseFenceTitle(
	meta: string | null | undefined,
): string | undefined {
	if (!meta) return undefined;
	const closingQuotes: Record<string, string> = {
		'"': '"',
		"'": "'",
		"“": "”",
	};
	const lastQuotes: Record<string, number> = {
		'"': meta.lastIndexOf('"'),
		"'": meta.lastIndexOf("'"),
		"”": meta.lastIndexOf("”"),
	};
	const lastTerminator = Math.max(...Object.values(lastQuotes));
	let unquoted: string | undefined;
	let unterminated: string | undefined;
	const unquotedValue = /[^\s"'“{},]+/y;
	for (const match of meta.matchAll(/(?:^|[\s{,])title\s*[=:]/gi)) {
		let start = match.index + match[0].length;
		while (start < meta.length && /\s/.test(meta[start] ?? "")) start++;
		const closing = closingQuotes[meta[start] ?? ""];
		if (closing) {
			// A missing closing quote must not rescan the suffix for every title.
			if ((lastQuotes[closing] ?? -1) > start) {
				return (
					meta.slice(start + 1, meta.indexOf(closing, start + 1)).trim() ||
					undefined
				);
			}
			if (start >= lastTerminator && unterminated === undefined) {
				unterminated = meta.slice(start + 1);
			}
		} else if (unquoted === undefined) {
			unquotedValue.lastIndex = start;
			unquoted = unquotedValue.exec(meta)?.[0];
		}
	}
	return (unquoted ?? unterminated)?.trim() || undefined;
}

const FRONTMATTER =
	/^\uFEFF?\s*---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Splits a leading `---` YAML frontmatter block off a diagram source. */
export function splitFrontmatter(source: string): {
	body: string;
	frontmatter: string | undefined;
} {
	const match = FRONTMATTER.exec(source);
	if (!match) return { body: source, frontmatter: undefined };
	return { body: source.slice(match[0].length), frontmatter: match[1] };
}

// Shared with `label.ts`, which extracts labels the same way.
export function unquote(value: string): string {
	const trimmed = value.trim();
	const quote = trimmed[0];
	if (
		trimmed.length >= 2 &&
		(quote === '"' || quote === "'") &&
		trimmed.endsWith(quote)
	) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

/** `title:` from the diagram's own frontmatter (top-level key only). */
export function parseFrontmatterTitle(source: string): string | undefined {
	const { frontmatter } = splitFrontmatter(source);
	if (!frontmatter) return undefined;
	const match = /^title[ \t]*:(.+)$/m.exec(frontmatter);
	const title = match ? unquote(match[1] ?? "") : "";
	return title || undefined;
}

export type DiagramFileExtension = "mmd" | "png";

export function diagramFileName(
	slug: string,
	extension: DiagramFileExtension,
): string {
	return `${slug || DEFAULT_DIAGRAM_NAME}.${extension}`;
}

/** Source text as copied / saved to `.mmd`: trailing whitespace collapsed to one newline. */
export function normalizeDiagramSource(source: string): string {
	return `${source.trimEnd()}\n`;
}
