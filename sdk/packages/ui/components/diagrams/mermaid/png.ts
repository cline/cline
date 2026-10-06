/**
 * PNG export sizing: scale selection that keeps the longest edge (and the
 * base64-encoded result) within attachable limits, retry-with-smaller-scale
 * encoding, and SVG preparation for rasterization. Pure and DOM-free; the
 * canvas rasterizer lives in `dom.ts`.
 */

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// PNG export
// ---------------------------------------------------------------------------

/** Longest allowed PNG edge; keeps encoded output well under ~5 MiB. */
export const PNG_MAX_EDGE = 4096;
/** Crisp-but-modest baseline; Streamdown's fixed 5x is needlessly large. */
export const PNG_BASE_SCALE = 2;
export const PNG_MAX_DESIRED_SCALE = 3;

/**
 * Preferred export scale for a display: at least `PNG_BASE_SCALE`, following
 * the device pixel ratio up to `PNG_MAX_DESIRED_SCALE`. Non-finite or missing
 * ratios (SSR, odd embeds) yield the base scale.
 */
export function resolvePngDesiredScale(
	devicePixelRatio?: number | null,
): number {
	const ratio =
		typeof devicePixelRatio === "number" && Number.isFinite(devicePixelRatio)
			? Math.ceil(devicePixelRatio)
			: PNG_BASE_SCALE;
	return clamp(ratio, PNG_BASE_SCALE, PNG_MAX_DESIRED_SCALE);
}
/**
 * Attached images are validated on their base64 length, capped at 5 MiB
 * (`DEFAULT_MAX_IMAGE_ENCODED_BYTES` in `@cline/shared`'s `llms/media.ts`).
 */
export const PNG_MAX_ENCODED_BYTES = 5 * 1024 * 1024;
/** Each retry re-encodes at this fraction of the previous scale. */
export const PNG_RETRY_SCALE_FACTOR = 0.7;
export const PNG_MAX_ATTEMPTS = 4;
const FALLBACK_SVG_SIZE = { height: 600, width: 800 };

/** Whether a PNG of `byteLength` bytes stays attachable once base64-encoded. */
export function pngFitsAttachmentLimit(byteLength: number): boolean {
	return 4 * Math.ceil(byteLength / 3) <= PNG_MAX_ENCODED_BYTES;
}

export interface PngExportSize {
	height: number;
	scale: number;
	width: number;
}

/**
 * `scale = min(desiredScale, maxEdge / longestEdge)`. Small diagrams get the
 * desired (crisp) scale; larger ones are scaled down so the longest edge never
 * exceeds `maxEdge`, which is what keeps the encoded PNG attachable. A diagram
 * whose natural size already passes the cap is therefore shrunk (scale < 1)
 * rather than exported oversize. Non-finite or non-positive dimensions are
 * treated as 1px so the result is always a finite, positive number.
 */
export function computeExportScale(
	size: { height: number; width: number },
	desiredScale: number = PNG_BASE_SCALE,
	maxEdge: number = PNG_MAX_EDGE,
): number {
	const width = Number.isFinite(size.width) && size.width > 0 ? size.width : 1;
	const height =
		Number.isFinite(size.height) && size.height > 0 ? size.height : 1;
	return Math.min(desiredScale, maxEdge / Math.max(width, height));
}

/** Canvas dimensions for `computeExportScale`, rounded to whole pixels. */
export function computePngExportSize(
	size: { height: number; width: number },
	desiredScale: number = PNG_BASE_SCALE,
	maxEdge: number = PNG_MAX_EDGE,
): PngExportSize {
	const width = Number.isFinite(size.width) && size.width > 0 ? size.width : 1;
	const height =
		Number.isFinite(size.height) && size.height > 0 ? size.height : 1;
	const scale = computeExportScale(size, desiredScale, maxEdge);
	return {
		height: Math.max(1, Math.round(height * scale)),
		scale,
		width: Math.max(1, Math.round(width * scale)),
	};
}

/**
 * Encodes at the desired scale and, while the result is too large to attach
 * (see `pngFitsAttachmentLimit`), retries at `PNG_RETRY_SCALE_FACTOR` of the
 * previous scale. Retries stop at scale 1 (or earlier if the edge cap already
 * forced a smaller scale), after `PNG_MAX_ATTEMPTS`, or when a retry would not
 * shrink the image. The smallest attempt is returned even if it is still
 * oversize: it is still a valid PNG for a plain file download.
 */
export async function encodePngWithinLimit<T extends { size: number }>(
	natural: { height: number; width: number },
	encode: (size: PngExportSize) => Promise<T>,
	initialScale: number = PNG_BASE_SCALE,
): Promise<T> {
	let desired = initialScale;
	let previousScale = Number.POSITIVE_INFINITY;
	let result: T | undefined;
	for (let attempt = 0; attempt < PNG_MAX_ATTEMPTS; attempt += 1) {
		const size = computePngExportSize(natural, desired);
		if (result && size.scale >= previousScale) break;
		result = await encode(size);
		if (pngFitsAttachmentLimit(result.size)) return result;
		previousScale = size.scale;
		// The last attempt always drops to the 1x floor, so a geometric decay that
		// never quite reaches it can't leave a smaller export untried.
		desired =
			attempt + 2 >= PNG_MAX_ATTEMPTS
				? 1
				: Math.max(1, size.scale * PNG_RETRY_SCALE_FACTOR);
	}
	if (!result) throw new Error("Failed to encode PNG");
	return result;
}

export interface PreparedSvg {
	height: number;
	svg: string;
	width: number;
}

function readAttribute(tag: string, name: string): string | undefined {
	return new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag)?.[1];
}

function setAttribute(tag: string, name: string, value: string): string {
	const pattern = new RegExp(`(\\s${name}\\s*=\\s*)"[^"]*"`, "i");
	if (pattern.test(tag)) return tag.replace(pattern, `$1"${value}"`);
	return tag.replace(/^<svg/i, `<svg ${name}="${value}"`);
}

function parseLength(value: string | undefined): number | undefined {
	if (!value || value.includes("%")) return undefined;
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function viewBoxSize(
	tag: string,
): { height: number; width: number } | undefined {
	const parts = readAttribute(tag, "viewBox")
		?.trim()
		.split(/[\s,]+/)
		.map(Number.parseFloat);
	const width = parts?.[2];
	const height = parts?.[3];
	if (width && height && width > 0 && height > 0) return { height, width };
	return undefined;
}

/**
 * Makes Mermaid's SVG safe to load as a standalone image. Mermaid emits
 * `width="100%"` (no intrinsic size for `<img>`/canvas), so the root gets the
 * viewBox size; HTML-only entities/void tags are made XML-valid.
 */
export function prepareSvgForRaster(svg: string): PreparedSvg {
	const tagMatch = /<svg\b[^>]*>/i.exec(svg);
	if (!tagMatch) return { ...FALLBACK_SVG_SIZE, svg };
	let tag = tagMatch[0];
	const box = viewBoxSize(tag);
	const width =
		box?.width ??
		parseLength(readAttribute(tag, "width")) ??
		FALLBACK_SVG_SIZE.width;
	const height =
		box?.height ??
		parseLength(readAttribute(tag, "height")) ??
		FALLBACK_SVG_SIZE.height;

	tag = setAttribute(tag, "width", String(width));
	tag = setAttribute(tag, "height", String(height));
	tag = tag.replace(/\sstyle\s*=\s*"([^"]*)"/i, (attribute, value: string) =>
		value.toLowerCase().includes("max-width") ? "" : attribute,
	);
	if (!/\sxmlns\s*=/i.test(tag)) {
		tag = tag.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
	}
	if (/xlink:/i.test(svg) && !/\sxmlns:xlink\s*=/i.test(tag)) {
		tag = tag.replace(
			/^<svg/i,
			'<svg xmlns:xlink="http://www.w3.org/1999/xlink"',
		);
	}

	const sanitized = svg
		.replace(tagMatch[0], tag)
		.replace(/&nbsp;/g, "&#160;")
		.replace(/<(br|hr)\s*>/gi, "<$1/>");
	return { height, svg: sanitized, width };
}
