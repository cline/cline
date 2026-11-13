import { createHmac } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Route prefix: `/preview-file/<preview token>/<the path part of the file's `file:` URL>`. */
export const PREVIEW_FILE_ROUTE = "/preview-file";

/**
 * The token that unlocks the preview route. The previewed page can read it
 * from its own address, so it is derived one-way from the approval token
 * rather than being that token: knowing it grants nothing but previews.
 * The webview derives the same value (see `previewToken` in browser-panel).
 */
export function derivePreviewToken(approvalToken: string): string {
	return createHmac("sha256", approvalToken)
		.update("preview-file")
		.digest("hex");
}

/** Largest file the preview route will serve. */
export const MAX_PREVIEW_FILE_BYTES = 25 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".htm": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".md": "text/plain; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".wasm": "application/wasm",
};

/**
 * Resolves a requested absolute path to a real, regular file small enough to
 * serve. Any file on this machine qualifies: the preview token is the only
 * gate. Returns null for anything else.
 */
export async function resolvePreviewFile(
	requestedPath: string,
): Promise<string | null> {
	if (!requestedPath || requestedPath.includes("\0")) return null;
	if (!path.isAbsolute(requestedPath)) return null;
	try {
		const real = await realpath(path.resolve(requestedPath));
		const info = await stat(real);
		return info.isFile() && info.size <= MAX_PREVIEW_FILE_BYTES ? real : null;
	} catch {
		return null;
	}
}

/**
 * Splits the route into its token and the file it names. The part after the
 * token is the path of a `file:` URL, so Windows drive paths (`/C:/Users/…`)
 * and percent-encoding are read the way the platform reads file URLs.
 */
export function previewPathFromUrl(pathname: string): {
	token: string;
	filePath: string;
} | null {
	if (!pathname.startsWith(`${PREVIEW_FILE_ROUTE}/`)) return null;
	const rest = pathname.slice(PREVIEW_FILE_ROUTE.length + 1);
	const slash = rest.indexOf("/");
	if (slash < 1) return null;
	try {
		return {
			token: decodeURIComponent(rest.slice(0, slash)),
			filePath: fileURLToPath(`file://${rest.slice(slash)}`),
		};
	} catch {
		return null;
	}
}

const PREVIEW_UNAVAILABLE_HTML = `<!doctype html><meta charset="utf-8"><title>Preview unavailable</title>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:14px system-ui,sans-serif;color:#555;background:#fafafa">
<div style="max-width:420px;padding:24px;text-align:center">
<p style="font-size:16px;color:#222;margin:0 0 8px">Can't preview this file</p>
<p style="margin:0">There is no file at that path on this machine, or it is too large to preview. Check the path and try again.</p>
</div></body>`;

export async function servePreviewFile(filePath: string): Promise<Response> {
	const resolved = await resolvePreviewFile(filePath);
	if (!resolved) {
		// A readable page: a bare 404 in the panel's frame looks like a blank
		// white screen.
		return new Response(PREVIEW_UNAVAILABLE_HTML, {
			status: 404,
			headers: {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-store",
				"content-security-policy": "sandbox",
			},
		});
	}
	const body = await readFile(resolved);
	return new Response(body, {
		headers: {
			"content-type":
				CONTENT_TYPES[path.extname(resolved).toLowerCase()] ??
				"application/octet-stream",
			"cache-control": "no-store",
			"referrer-policy": "no-referrer",
			"x-content-type-options": "nosniff",
			// The sandboxed page has an opaque origin, so its own module scripts,
			// fonts and fetches are cross-origin and need this to load. The token
			// in the path is what gates access, not the origin.
			"access-control-allow-origin": "*",
			// An opaque origin keeps the page away from the sidecar's own API.
			"content-security-policy":
				"sandbox allow-scripts allow-forms allow-modals allow-pointer-lock allow-popups allow-downloads",
		},
	});
}
