/** Maximum UTF-8 payload sent inline for the preferred srcdoc render path. */
export const MAX_INLINE_HTML_BYTES = 8 * 1024 * 1024

/** Measure HTML exactly as it will be encoded on the gRPC/webview boundary. */
export function getHtmlUtf8ByteLength(html: string): number {
	return Buffer.byteLength(html, "utf8")
}

/** Larger artifacts remain on disk and render through their webview URI. */
export function shouldInlineHtml(byteLength: number): boolean {
	return byteLength <= MAX_INLINE_HTML_BYTES
}
