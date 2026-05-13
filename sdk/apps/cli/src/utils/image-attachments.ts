import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const IMAGE_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".bmp",
	".svg",
]);

// Unicode whitespace code points that can appear in macOS-generated filenames
// (or get introduced when paths travel through clipboards / terminals that
// substitute U+0020 for the original character).
//
// Most notable: U+202F (NARROW NO-BREAK SPACE) which macOS Sonoma+ inserts
// before AM/PM in screenshot filenames like
//   "Screenshot 2026-05-12 at 4.42.48\u202FPM.png".
const UNICODE_SPACES_RE = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const NARROW_NO_BREAK_SPACE = "\u202F";

// Build a "canonical whitespace" key for a filename so we can compare a pasted
// path against actual on-disk entries regardless of which exotic space variant
// was used between segments.
function collapseUnicodeWhitespace(name: string): string {
	return name.normalize("NFC").replace(UNICODE_SPACES_RE, " ");
}

function tryMacOSAmPmVariant(filePath: string): string {
	// macOS uses U+202F before AM/PM in screenshot names. Some locales
	// (e.g. en_AU) emit lowercase am/pm, hence the case-insensitive match.
	return filePath.replace(/ (AM|PM)\./gi, `${NARROW_NO_BREAK_SPACE}$1.`);
}

function tryNFDVariant(filePath: string): string {
	// Older HFS+ / some APFS configurations store filenames in NFD
	// (decomposed) form. Users typically type / paste NFC. Try the NFD
	// variant if the literal path didn't resolve.
	return filePath.normalize("NFD");
}

function tryCurlyApostropheVariant(filePath: string): string {
	// macOS uses U+2019 (right single quotation mark) in localized screenshot
	// names like "Capture d'écran". Users typically type U+0027.
	return filePath.replace(/'/g, "\u2019");
}

function scanDirForCanonicalMatch(filePath: string): string | undefined {
	// Last-resort fallback: enumerate the parent directory and look for an
	// entry whose canonical-whitespace form matches the pasted filename's.
	// This catches arbitrary exotic-space mismatches that the targeted
	// variants above don't cover.
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
 * Resolve a possibly-mangled image path to an actual on-disk file.
 *
 * Returns the literal path when it already exists; otherwise tries a small
 * set of macOS-specific variants (narrow no-break space before AM/PM, NFD
 * normalization, curly apostrophe) before falling back to a parent-directory
 * scan that compares filenames after collapsing exotic Unicode whitespace.
 *
 * Returns `undefined` when no matching file can be located.
 */
export function resolveExistingImagePath(filePath: string): string | undefined {
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

export function isImagePath(filePath: string): boolean {
	const normalized = filePath.toLowerCase();
	for (const extension of IMAGE_EXTENSIONS) {
		if (normalized.endsWith(extension)) {
			return true;
		}
	}
	return false;
}

export function getImageMimeType(filePath: string): string {
	const ext = filePath.toLowerCase().split(".").pop() || "";
	const mimeTypes: Record<string, string> = {
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		gif: "image/gif",
		webp: "image/webp",
		bmp: "image/bmp",
		svg: "image/svg+xml",
	};
	return mimeTypes[ext] || "image/png";
}

export function bufferToImageDataUrl(buffer: Buffer, mimeType: string): string {
	return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

export function loadImageAsDataUrl(filePath: string): string {
	try {
		const buffer = readFileSync(filePath);
		return bufferToImageDataUrl(buffer, getImageMimeType(filePath));
	} catch (error) {
		throw new Error(
			`Failed to load image from ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
