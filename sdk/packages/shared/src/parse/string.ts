export function sanitizeFileName(value: string): string {
	return value.toLowerCase().replace(/[^\w.-]+/g, "_");
}

export function trimNonEmpty(
	value: string | null | undefined,
): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

/**
 * Code points above U+FFFF (emoji, most CJK extensions, mathematical
 * alphanumerics) need two UTF-16 units, so a JS string index can land between
 * the halves of one character. Slicing there leaves both halves unpaired, and
 * every later serialization of that text — a JSON provider payload, a log line,
 * a tty write — encodes each half as U+FFFD (`�`). Truncation is therefore the
 * point where a cut has to be nudged to the nearest code point boundary
 * (cline/cline#14562).
 */
function isHighSurrogate(code: number): boolean {
	return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
	return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * The first `count` UTF-16 units of `text`, retreating by one unit when the cut
 * would land between the halves of a surrogate pair. Never longer than `count`,
 * and never ends on an unpaired high surrogate.
 */
export function sliceHeadAtCodePointBoundary(
	text: string,
	count: number,
): string {
	if (count <= 0) return "";
	if (count >= text.length) return text;
	const splitsPair =
		isHighSurrogate(text.charCodeAt(count - 1)) &&
		isLowSurrogate(text.charCodeAt(count));
	return text.slice(0, splitsPair ? count - 1 : count);
}

/**
 * The last `count` UTF-16 units of `text`, advancing by one unit when the cut
 * would land between the halves of a surrogate pair. Never longer than `count`,
 * and never starts on an unpaired low surrogate.
 */
export function sliceTailAtCodePointBoundary(
	text: string,
	count: number,
): string {
	if (count <= 0) return "";
	if (count >= text.length) return text;
	const start = text.length - count;
	const splitsPair =
		isHighSurrogate(text.charCodeAt(start - 1)) &&
		isLowSurrogate(text.charCodeAt(start));
	return text.slice(splitsPair ? start + 1 : start);
}

export function truncateStr(str: string, maxLen: number): string {
	if (str.length <= maxLen) return str;
	return `${sliceHeadAtCodePointBoundary(str, maxLen - 1)}…`;
}

export function truncateSplit(
	str?: string,
	splitBy = "/",
	maxLen = 100,
): string {
	if (!str || str.length <= maxLen) return str || "";
	const segment = str.split(splitBy)?.shift()?.trim();
	const prefix = segment
		? sliceHeadAtCodePointBoundary(segment, maxLen - 1)
		: undefined;
	return prefix ? `${prefix}…` : truncateStr(str, maxLen);
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
