/**
 * Path-resolution helpers that tolerate Unicode variants commonly seen on
 * macOS filenames (most notably U+202F NARROW NO-BREAK SPACE in screenshot
 * timestamps like "Screenshot 2026-05-12 at 4.42.48\u202FPM.png").
 *
 * When such a path travels through clipboards, terminals, paste-decoders,
 * or other layers that normalize whitespace, U+202F can collapse to a
 * regular space (U+0020). The on-disk filename still contains U+202F, so
 * a literal `fs.stat` / `fs.readFile` will fail with ENOENT.
 *
 * `resolveExistingFilePath` tries a small set of targeted variants and a
 * last-resort parent-directory scan to recover the actual filename.
 */
import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

// Unicode whitespace code points that show up in macOS-generated filenames
// (or get substituted away by clipboards / terminals).
const UNICODE_SPACES_RE = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const NARROW_NO_BREAK_SPACE = "\u202F";

// Build a "canonical whitespace" key for comparing a pasted/typed path
// against actual on-disk entries regardless of which exotic space variant
// was used between segments.
function collapseUnicodeWhitespace(name: string): string {
	return name.normalize("NFC").replace(UNICODE_SPACES_RE, " ");
}

function tryMacOSAmPmVariant(filePath: string): string {
	// macOS Sonoma+ inserts U+202F before AM/PM in screenshot names. Some
	// locales (e.g. en_AU) emit lowercase am/pm; hence the /i flag.
	return filePath.replace(/ (AM|PM)\./gi, `${NARROW_NO_BREAK_SPACE}$1.`);
}

function tryNFDVariant(filePath: string): string {
	// HFS+ / some APFS configurations store filenames decomposed. Users
	// typically type or paste NFC. Try the NFD variant when the literal
	// path didn't resolve.
	return filePath.normalize("NFD");
}

function tryCurlyApostropheVariant(filePath: string): string {
	// macOS uses U+2019 (right single quotation mark) in localized
	// screenshot names like "Capture d'écran". Users typically type U+0027.
	return filePath.replace(/'/g, "\u2019");
}

function scanDirForCanonicalMatch(filePath: string): string | undefined {
	// Last-resort fallback: enumerate the parent directory and look for an
	// entry whose canonical-whitespace form matches the requested basename.
	// Catches arbitrary exotic-space mismatches the targeted variants
	// above don't cover.
	const dir = dirname(filePath);
	const wanted = collapseUnicodeWhitespace(basename(filePath));
	try {
		for (const entry of readdirSync(dir)) {
			if (collapseUnicodeWhitespace(entry) === wanted) {
				return join(dir, entry);
			}
		}
	} catch {
		// Directory unreadable or missing -- nothing to fall back to.
	}
	return undefined;
}

/**
 * Resolve a possibly-mangled file path to an actual on-disk entry.
 *
 * Returns the literal path when it already exists; otherwise tries a small
 * set of macOS-specific variants (narrow no-break space before AM/PM, NFD
 * normalization, curly apostrophe) before falling back to a parent-directory
 * scan that compares filenames after collapsing exotic Unicode whitespace.
 *
 * Returns `undefined` when no matching file can be located.
 */
export function resolveExistingFilePath(filePath: string): string | undefined {
	if (existsSync(filePath)) {
		return filePath;
	}

	const amPmVariant = tryMacOSAmPmVariant(filePath);
	if (amPmVariant !== filePath && existsSync(amPmVariant)) {
		return amPmVariant;
	}

	const nfdVariant = tryNFDVariant(filePath);
	if (nfdVariant !== filePath && existsSync(nfdVariant)) {
		return nfdVariant;
	}

	const curlyVariant = tryCurlyApostropheVariant(filePath);
	if (curlyVariant !== filePath && existsSync(curlyVariant)) {
		return curlyVariant;
	}

	const nfdCurlyVariant = tryCurlyApostropheVariant(nfdVariant);
	if (nfdCurlyVariant !== filePath && existsSync(nfdCurlyVariant)) {
		return nfdCurlyVariant;
	}

	return scanDirForCanonicalMatch(filePath);
}
