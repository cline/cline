/**
 * Neutralizes navigable links inside rendered Mermaid SVGs. The owned block
 * injects the SVG with dangerouslySetInnerHTML, so this is the one place a
 * diagram link can be stopped from bypassing the host's link policy.
 */

// ---------------------------------------------------------------------------
// Diagram links
// ---------------------------------------------------------------------------

/**
 * Carries a diagram link's original destination once the navigable href has
 * been removed, so hosts can offer their own vetted way to open it.
 */
export const DIAGRAM_LINK_HREF_ATTRIBUTE = "data-cline-diagram-href";

/** Attributes that would let an anchor navigate on its own. */
const NAVIGABLE_LINK_ATTRIBUTES = ["href", "xlink:href"] as const;

function openableHref(value: string): string | null {
	try {
		const parsed = new URL(value.trim());
		return parsed.protocol === "http:" || parsed.protocol === "https:"
			? parsed.href
			: null;
	} catch {
		return null;
	}
}

function neutralizeWithDom(svg: string): string | null {
	if (
		typeof DOMParser === "undefined" ||
		typeof XMLSerializer === "undefined"
	) {
		return null;
	}
	try {
		const document = new DOMParser().parseFromString(svg, "image/svg+xml");
		if (document.getElementsByTagName("parsererror").length > 0) return null;

		for (const anchor of Array.from(document.getElementsByTagName("a"))) {
			const destination = NAVIGABLE_LINK_ATTRIBUTES.map((attribute) =>
				anchor.getAttribute(attribute),
			).find((value): value is string => Boolean(value));

			for (const attribute of NAVIGABLE_LINK_ATTRIBUTES) {
				anchor.removeAttribute(attribute);
			}
			// `target` alone cannot navigate, but leaving it invites a future
			// re-add of href to open in a new context without host review.
			anchor.removeAttribute("target");

			const openable = destination ? openableHref(destination) : null;
			if (openable) anchor.setAttribute(DIAGRAM_LINK_HREF_ATTRIBUTE, openable);
		}

		return new XMLSerializer().serializeToString(document.documentElement);
	} catch {
		return null;
	}
}

const ANCHOR_OPEN_TAG_PATTERN = /<a\b[^>]*>/gi;
const LINK_ATTRIBUTE_PATTERN =
	/\s(?:xlink:href|href|target)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

function neutralizeWithPatterns(svg: string): string {
	return svg.replace(ANCHOR_OPEN_TAG_PATTERN, (openTag) => {
		let destination: string | null = null;
		const stripped = openTag.replace(
			LINK_ATTRIBUTE_PATTERN,
			(match, doubleQuoted?: string, singleQuoted?: string) => {
				if (!/\starget\s*=/i.test(match)) {
					destination ??= doubleQuoted ?? singleQuoted ?? null;
				}
				return "";
			},
		);
		const openable = destination ? openableHref(destination) : null;
		if (!openable) return stripped;
		return stripped.replace(
			/\s*\/?>$/,
			(tail) =>
				` ${DIAGRAM_LINK_HREF_ATTRIBUTE}="${openable.replace(/"/g, "&quot;")}"${tail}`,
		);
	});
}

/**
 * Mermaid's `securityLevel: "strict"` blocks script execution and dangerous URL
 * schemes, but still renders `click <node> "https://…"` directives as live
 * `<a xlink:href>` anchors inside the SVG. Streamdown injects that SVG with
 * `dangerouslySetInnerHTML`, so those anchors never pass through a product's
 * React link component — bypassing whatever link policy the host applies to
 * ordinary Markdown links (confirmation prompts, external-open routing), and in
 * a desktop webview letting a click navigate the app away from itself.
 *
 * A diagram label is authored independently of its destination, so these links
 * are deceptive by construction. Strip the navigable attributes so a diagram
 * link cannot navigate on its own, and preserve an http(s) destination in
 * `DIAGRAM_LINK_HREF_ATTRIBUTE` so hosts can opt into opening it deliberately.
 */
export function neutralizeDiagramLinks(svg: string): string {
	if (!svg.includes("<a")) return svg;
	return neutralizeWithDom(svg) ?? neutralizeWithPatterns(svg);
}
