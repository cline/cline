"use client";

import { agentMarkdownControls, markdownCodeHighlighter } from "@cline/ui/components/markdown";
import { cjk } from "@streamdown/cjk";
import { memo } from "react";
import { Streamdown } from "streamdown";

const plugins = { cjk, code: markdownCodeHighlighter };

export const Markdown = memo(function Markdown({ content, streaming = false }: { content: string; streaming?: boolean }) {
	return <Streamdown className="cline-markdown" controls={agentMarkdownControls} dir="auto" isAnimating={streaming} lineNumbers={false} mode={streaming ? "streaming" : "static"} normalizeHtmlIndentation parseIncompleteMarkdown={streaming} plugins={plugins}>{content}</Streamdown>;
});
