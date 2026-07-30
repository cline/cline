/**
 * Shared SVG stub builder for hub show producers (no external renderers).
 */

export function escapeXmlText(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

export function buildCardSvg(input: {
	title: string;
	body: string;
	width?: number;
	height?: number;
}): string {
	const width = input.width ?? 640;
	const height = input.height ?? 360;
	const title = escapeXmlText(input.title);
	const body = escapeXmlText(input.body);
	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#0b1020"/>
  <text x="24" y="36" fill="#e2e8f0" font-family="monospace" font-size="16">${title}</text>
  <foreignObject x="24" y="56" width="${width - 48}" height="${height - 72}">
    <pre xmlns="http://www.w3.org/1999/xhtml" style="color:#94a3b8;font:12px monospace;white-space:pre-wrap;margin:0">${body}</pre>
  </foreignObject>
</svg>`;
}

export function svgDataUri(svg: string): string {
	return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
