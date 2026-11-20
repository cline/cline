export function sanitizeFileName(value: string): string {
	return value.toLowerCase().replace(/[^\w.-]+/g, "_");
}

export function trimNonEmpty(
	value: string | null | undefined,
): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function normalizeSliceOffset(offset: number, length: number): number {
	const integer = Math.trunc(offset) || 0;
	return integer < 0
		? Math.max(length + integer, 0)
		: Math.min(integer, length);
}

function splitsSurrogatePair(text: string, offset: number): boolean {
	const before = text.charCodeAt(offset - 1);
	const after = text.charCodeAt(offset);
	return (
		before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
	);
}

/**
 * Like String.slice, but moves cuts inward when they split a surrogate pair.
 * Budgets remain UTF-16 code units; existing unpaired surrogates are unchanged.
 */
export function sliceUtf16(
	text: string,
	start: number,
	end = text.length,
): string {
	let from = normalizeSliceOffset(start, text.length);
	let to = normalizeSliceOffset(end, text.length);
	if (splitsSurrogatePair(text, from)) from++;
	if (splitsSurrogatePair(text, to)) to--;
	return text.slice(from, Math.max(from, to));
}

export function truncateStr(str: string, maxLen: number): string {
	if (str.length <= maxLen) return str;
	return `${sliceUtf16(str, 0, maxLen - 1)}…`;
}

export function truncateSplit(
	str?: string,
	splitBy = "/",
	maxLen = 100,
): string {
	if (!str || str.length <= maxLen) return str || "";
	const prefix = str.split(splitBy)?.shift()?.trim();
	const truncatedPrefix = prefix && sliceUtf16(prefix, 0, maxLen - 1);
	return truncatedPrefix ? `${truncatedPrefix}…` : truncateStr(str, maxLen);
}

export function maskSecret(value: string): string {
	if (value.length <= 8) {
		return "****";
	}
	return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

/**
 * Strip a leading UTF-8 byte order mark (BOM, U+FEFF) from decoded text.
 *
 * Text editors on Windows (e.g. Notepad's "UTF-8" encoding option) prepend this mark to
 * signal the encoding, but `fs.readFileSync(path, "utf8")` does not strip it, so it survives
 * into the decoded string as a leading `\uFEFF` character. Frontmatter parsers anchor on
 * `^---` and silently fail to match when that character is present, hiding the file's
 * name/description (see cline/cline#12151).
 *
 * We only need to check for this one mark: a BOM disambiguates byte order for multi-byte
 * code units (UTF-16, UTF-32), but UTF-8 is a byte-oriented encoding with no byte-order
 * ambiguity to resolve, so it has exactly one BOM encoding (`EF BB BF`, i.e. U+FEFF) rather
 * than a family of them. Every caller of this helper already reads its input as `utf8`, so a
 * file actually encoded as UTF-16/32 would be mis-decoded well before reaching here.
 */
export function stripUtf8Bom(text: string): string {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
