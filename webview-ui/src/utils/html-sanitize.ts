/**
 * Escapes HTML special characters to prevent XSS attacks.
 * Use this when rendering user-provided or external data as HTML.
 */
export function escapeHtml(text: string): string {
	const htmlEscapes: Record<string, string> = {
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;",
	}
	return text.replace(/[&<>"']/g, (char) => htmlEscapes[char])
}
