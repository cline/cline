const ABSOLUTE_PATH = /^(?:\/|[a-z]:[\\/]|\\\\)/i
const URL_WITH_SCHEME = /^[a-z][a-z0-9+.-]*:/i

/**
 * Classifies a markdown link href as a link to a local file, or not one.
 *
 * The model writes paths the way a shell shows them: a POSIX or Windows absolute path, a UNC path, a
 * `file:` URL, or a path relative to the workspace. None of those is a web link the webview could
 * navigate to, so they are opened in the editor instead. Core resolves the path on the platform the
 * file lives on.
 *
 * The markdown parser percent-encodes a link destination (`C:\x` arrives as `C:%5Cx`, a space as
 * `%20`), so a path is decoded back to what was written. A `file:` URL is a URL already and is passed
 * on as is.
 */
export function localFileLink(href: string): { kind: "absolute" | "relative"; path: string } | undefined {
	if (!href || href.startsWith("#")) {
		return undefined
	}
	if (/^file:/i.test(href)) {
		return { kind: "absolute", path: href }
	}
	const path = decode(href)
	if (ABSOLUTE_PATH.test(path)) {
		return { kind: "absolute", path }
	}
	if (URL_WITH_SCHEME.test(path)) {
		return undefined
	}
	return { kind: "relative", path }
}

function decode(href: string): string {
	try {
		return decodeURIComponent(href)
	} catch {
		return href
	}
}
