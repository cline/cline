import type { HtmlPreviewItem } from "@shared/proto/cline/html_preview"

export const LEARNING_PACK_METADATA_KIND = "learning-pack-v1"

export interface LearningPackScope {
	packId: string
	courseId: string
	edition: "student" | "instructor"
	moduleId: string
}

/**
 * Installed Learning Packs execute in the existing preview iframe, but use a
 * host-owned child-document CSP. The generic preview shell intentionally keeps
 * its current permissive scientific-visualization policy for legacy artifacts.
 */
function localResourceOrigin(dirUri?: string): string | null {
	if (!dirUri) return null
	try {
		const url = new URL(dirUri)
		return url.protocol === "https:" ? url.origin : null
	} catch {
		return null
	}
}

export function buildInstalledPackCsp(dirUri?: string): string {
	const local = localResourceOrigin(dirUri)
	const packaged = local ? ` ${local}` : ""
	return [
		"default-src 'none'",
		"script-src 'unsafe-inline'",
		`style-src 'unsafe-inline'${packaged}`,
		`img-src data: blob:${packaged}`,
		`font-src data:${packaged}`,
		`media-src data: blob:${packaged}`,
		"connect-src 'none'",
		"frame-src 'none'",
		"child-src 'none'",
		"worker-src 'none'",
		"object-src 'none'",
		"form-action 'none'",
		local ? `base-uri ${local}` : "base-uri 'none'",
	].join("; ")
}

export const INSTALLED_PACK_CSP = buildInstalledPackCsp()

const AUTHORED_CSP_META =
	/<meta\b(?=[^>]*\bhttp-equiv\s*=\s*(?:["']\s*content-security-policy(?:-report-only)?\s*["']|content-security-policy(?:-report-only)?(?:\s|\/?>)))[^>]*>/giu
const AUTHORED_BASE = /<base\b[^>]*>/giu

export function isInstalledLearningPack(item?: HtmlPreviewItem): boolean {
	return item?.metadata?.artifactKind === LEARNING_PACK_METADATA_KIND
}

export function learningPackScopeFromItem(item?: HtmlPreviewItem): LearningPackScope | null {
	if (!isInstalledLearningPack(item)) return null
	const metadata = item?.metadata
	const edition = metadata?.learningPackEdition
	if (
		!metadata?.learningPackId ||
		!metadata.learningPackCourseId ||
		!metadata.learningPackModuleId ||
		(edition !== "student" && edition !== "instructor")
	) {
		return null
	}
	return {
		packId: metadata.learningPackId,
		courseId: metadata.learningPackCourseId,
		edition,
		moduleId: metadata.learningPackModuleId,
	}
}

/**
 * Remove authored CSP declarations and insert the host policy before any pack
 * script or resource element. A pack CSP could only add restrictions in a
 * conforming browser, but removing it makes the effective policy deterministic
 * and prevents confusing report-only or malformed declarations.
 */
export function applyInstalledPackCsp(html: string, dirUri?: string): string {
	const withoutAuthoredCsp = html.replace(AUTHORED_CSP_META, "").replace(AUTHORED_BASE, "")
	const csp = buildInstalledPackCsp(dirUri)
	const normalizedDir = dirUri ? `${dirUri.replace(/\/+$/u, "")}/` : ""
	const base = normalizedDir ? `<base href="${normalizedDir.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;")}">` : ""
	const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">${base}`
	const head = withoutAuthoredCsp.match(/<head\b[^>]*>/iu)
	if (head?.index !== undefined) {
		const insertAt = head.index + head[0].length
		return `${withoutAuthoredCsp.slice(0, insertAt)}${meta}${withoutAuthoredCsp.slice(insertAt)}`
	}
	const htmlOpen = withoutAuthoredCsp.match(/<html\b[^>]*>/iu)
	if (htmlOpen?.index !== undefined) {
		const insertAt = htmlOpen.index + htmlOpen[0].length
		return `${withoutAuthoredCsp.slice(0, insertAt)}<head>${meta}</head>${withoutAuthoredCsp.slice(insertAt)}`
	}
	return `<head>${meta}</head>${withoutAuthoredCsp}`
}
