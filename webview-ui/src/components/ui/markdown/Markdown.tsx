import { FC, memo } from "react"
import ReactMarkdown, { Options } from "react-markdown"
import remarkGfm from "remark-gfm"

import { Separator } from "@/components/ui"

import { CodeBlock } from "./CodeBlock"
import { Blockquote } from "./Blockquote"

const MemoizedReactMarkdown: FC<Options> = memo(
	ReactMarkdown,
	(prevProps, nextProps) => prevProps.children === nextProps.children && prevProps.className === nextProps.className,
)

export function Markdown({ content }: { content: string }) {
	return (
		<MemoizedReactMarkdown
			remarkPlugins={[remarkGfm]}
			className="custom-markdown break-words"
			components={{
				p({ children }) {
					return <div className="mb-2 last:mb-0">{children}</div>
				},
				hr() {
					return <Separator />
				},
				ol({ children }) {
					return (
						<ol className="list-decimal pl-4 [&>li]:mb-1 [&>li:last-child]:mb-0 [&>li>ul]:mt-1 [&>li>ol]:mt-1">
							{children}
						</ol>
					)
				},
				ul({ children }) {
					return (
						<ul className="list-disc pl-4 [&>li]:mb-1 [&>li:last-child]:mb-0 [&>li>ul]:mt-1 [&>li>ol]:mt-1">
							{children}
						</ul>
					)
				},
				blockquote({ children }) {
					return <Blockquote>{children}</Blockquote>
				},
				code({ className, children, ...props }) {
					if (children && Array.isArray(children) && children.length) {
						if (children[0] === "▍") {
							return <span className="mt-1 animate-pulse cursor-default">▍</span>
						}

						children[0] = (children[0] as string).replace("`▍`", "▍")
					}

					const match = /language-(\w+)/.exec(className || "")

					const isInline =
						props.node?.position && props.node.position.start.line === props.node.position.end.line

					return isInline ? (
						<code className={className} {...props}>
							{children}
						</code>
					) : (
						<CodeBlock
							language={(match && match[1]) || ""}
							value={String(children).replace(/\n$/, "")}
							className="rounded-xs p-3 mb-2"
						/>
					)
				},
				a({ href, children }) {
					return (
						<a href={href} target="_blank" rel="noopener noreferrer">
							{children}
						</a>
					)
				},
			}}>
			{content}
		</MemoizedReactMarkdown>
	)
}
