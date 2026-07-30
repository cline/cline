import { createHash } from "node:crypto";
import type { ShowBacklogItem } from "@cline/shared";
import {
	assertMermaidSource,
	getShowTemplate,
	MermaidParseError,
} from "@cline/drive";

export type ProduceMermaidInput = {
	templateId?: string;
	mermaidSource: string;
	ownerParticipantId: string;
	title?: string;
	caption?: string;
};

export type ProduceMermaidResult = {
	item: ShowBacklogItem;
	svg: string;
	cacheHit: boolean;
};

export { MermaidParseError };

const svgCache = new Map<string, string>();

export function mermaidCacheKey(source: string): string {
	return createHash("sha256").update(source).digest("hex");
}

/**
 * Produce an SVG artifact for a mermaid diagram.
 * Uses a deterministic SVG wrapper (no mermaid runtime required in core).
 * Webview may re-render from embedded source; hub caches by content hash.
 * Fail closed: invalid mermaidSource throws MermaidParseError (no uri).
 */
export function produceMermaidShowArtifact(
	input: ProduceMermaidInput,
): ProduceMermaidResult {
	assertMermaidSource(input.mermaidSource);
	const template = input.templateId
		? getShowTemplate(input.templateId)
		: undefined;
	const key = mermaidCacheKey(input.mermaidSource);
	const cached = svgCache.get(key);
	const cacheHit = Boolean(cached);
	const svg =
		cached ??
		buildStubSvg(
			input.title ?? template?.title ?? "Diagram",
			input.mermaidSource,
		);
	if (!cacheHit) {
		svgCache.set(key, svg);
	}
	const uri = `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
	const item: ShowBacklogItem = {
		id: `show-${key.slice(0, 12)}`,
		ownerParticipantId: input.ownerParticipantId,
		title: input.title ?? template?.title ?? "Diagram",
		intent: template?.intent ?? "Explain structure",
		artifactKind: template?.artifactKind ?? "diagram.architecture",
		mediaClass: "still",
		uri,
		caption: input.caption ?? input.title ?? "Diagram",
		produce: {
			tool: "render_mermaid",
			templateId: input.templateId,
			args: { mermaidSource: input.mermaidSource },
		},
		priority: 10,
		status: "ready",
		scoreReasons: cacheHit ? ["cache_hit"] : ["produced"],
	};
	return { item, svg, cacheHit };
}

function buildStubSvg(title: string, mermaidSource: string): string {
	const escaped = mermaidSource
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="#0b1020"/>
  <text x="24" y="36" fill="#e2e8f0" font-family="monospace" font-size="16">${title.replaceAll("<", "")}</text>
  <foreignObject x="24" y="56" width="592" height="280">
    <pre xmlns="http://www.w3.org/1999/xhtml" style="color:#94a3b8;font:12px monospace;white-space:pre-wrap;margin:0">${escaped}</pre>
  </foreignObject>
</svg>`;
}

/** @internal */
export function __clearMermaidCacheForTests(): void {
	svgCache.clear();
}
