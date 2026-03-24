import { marked } from "marked";
import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const MemoizedMarkdownBlock = memo(
	({ content }: { content: string }) => {
		return (
			<div className="markdown">
				<ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
			</div>
		);
	},
	(prevProps, nextProps) => {
		if (prevProps.content !== nextProps.content) return false;
		return true;
	},
);

MemoizedMarkdownBlock.displayName = "MemoizedMarkdownBlock";

export function parseMarkdownIntoBlocks(markdown: string): string[] {
	const tokens = marked.lexer(markdown);
	return tokens.map((token) => token.raw);
}

export const MemoizedMarkdown = memo(
	({ content, id }: { content: string; id: string }) => {
		const blocks = useMemo(() => parseMarkdownIntoBlocks(content), [content]);
		const occurrences = new Map<string, number>();

		return blocks.map((block, index) => {
			const occurrence = (occurrences.get(block) ?? 0) + 1;
			occurrences.set(block, occurrence);
			return (
				<MemoizedMarkdownBlock
					content={block}
					key={`${id}-block_${index}-${occurrence}`}
				/>
			);
		});
	},
);

MemoizedMarkdown.displayName = "MemoizedMarkdown";
