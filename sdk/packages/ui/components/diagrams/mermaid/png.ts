/**
 * PNG export sizing: scale selection that keeps the longest edge (and the
 * base64-encoded result) within attachable limits, retry-with-smaller-scale
 * encoding, and SVG preparation for rasterization. Pure and DOM-free; the
 * canvas rasterizer lives in `dom.ts`.
 */

import { PNG_EXPORT } from "./config.js";

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/**
 * Preferred export scale for a display: at least the base scale, following
 * the device pixel ratio up to `PNG_EXPORT.maxDesiredScale`. Missing or
 * non-finite ratios (SSR, odd embeds) yield the base scale.
 */
export function resolvePngDesiredScale(
	devicePixelRatio?: number | null,
): number {
	const ratio =
		typeof devicePixelRatio === "number" && Number.isFinite(devicePixelRatio)
			? Math.ceil(devicePixelRatio)
			: PNG_EXPORT.baseScale;
	return clamp(ratio, PNG_EXPORT.baseScale, PNG_EXPORT.maxDesiredScale);
}

/** Whether a PNG of `byteLength` bytes stays attachable once base64-encoded. */
export function pngFitsAttachmentLimit(byteLength: number): boolean {
	return 4 * Math.ceil(byteLength / 3) <= PNG_EXPORT.maxEncodedBytes;
}

export interface PngExportSize {
	height: number;
	scale: number;
	width: number;
}

/**
 * `scale = min(desiredScale, maxEdge / longestEdge)`: small diagrams keep the
 * crisp desired scale, larger ones shrink so the longest edge never exceeds
 * `maxEdge` — which is what keeps the encoded PNG attachable. A diagram whose
 * natural size already passes the cap shrinks below 1x rather than exporting
 * oversize.
 */
export function computeExportScale(
	size: { height: number; width: number },
	desiredScale: number = PNG_EXPORT.baseScale,
	maxEdge: number = PNG_EXPORT.maxEdge,
): number {
	const width = Number.isFinite(size.width) && size.width > 0 ? size.width : 1;
	const height =
		Number.isFinite(size.height) && size.height > 0 ? size.height : 1;
	return Math.min(desiredScale, maxEdge / Math.max(width, height));
}

/** Canvas dimensions for `computeExportScale`, rounded to whole pixels. */
export function computePngExportSize(
	size: { height: number; width: number },
	desiredScale: number = PNG_EXPORT.baseScale,
	maxEdge: number = PNG_EXPORT.maxEdge,
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
 * (see `pngFitsAttachmentLimit`), retries at a fraction of the previous scale
 * — never below 1x. The smallest attempt is returned even if it is still
 * oversize: it is still a valid PNG for a plain file download.
 */
export async function encodePngWithinLimit<T extends { size: number }>(
	natural: { height: number; width: number },
	encode: (size: PngExportSize) => Promise<T>,
	initialScale: number = PNG_EXPORT.baseScale,
): Promise<T> {
	let desired = initialScale;
	let previousScale = Number.POSITIVE_INFINITY;
	let result: T | undefined;
	for (let attempt = 0; attempt < PNG_EXPORT.attemptLimit; attempt += 1) {
		const size = computePngExportSize(natural, desired);
		if (result && size.scale >= previousScale) break;
		result = await encode(size);
		if (pngFitsAttachmentLimit(result.size)) return result;
		previousScale = size.scale;
		// The last retry drops straight to the 1x floor so the geometric decay
		// cannot exhaust the attempts just above it.
		desired =
			attempt + 2 >= PNG_EXPORT.attemptLimit
				? 1
				: Math.max(1, size.scale * PNG_EXPORT.retryScaleFactor);
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
	if (!tagMatch) return { ...PNG_EXPORT.fallbackSvg, svg };
	let tag = tagMatch[0];
	const box = viewBoxSize(tag);
	const width =
		box?.width ??
		parseLength(readAttribute(tag, "width")) ??
		PNG_EXPORT.fallbackSvg.width;
	const height =
		box?.height ??
		parseLength(readAttribute(tag, "height")) ??
		PNG_EXPORT.fallbackSvg.height;

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
