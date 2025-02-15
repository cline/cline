import { FC, memo } from "react"
import ReactMarkdown, { Options } from "react-markdown"

import { Separator } from "@/components/ui"

import { CodeBlock } from "./CodeBlock"
import { SourceNumberButton } from "./SourceNumberButton"
import { Blockquote } from "./Blockquote"

const MemoizedReactMarkdown: FC<Options> = memo(
	ReactMarkdown,
	(prevProps, nextProps) => prevProps.children === nextProps.children && prevProps.className === nextProps.className,
)

const preprocessLaTeX = (content: string) => {
	// Replace block-level LaTeX delimiters \[ \] with $$ $$
	const blockProcessedContent = content.replace(/\\\[([\s\S]*?)\\\]/g, (_, equation) => `$$${equation}$$`)

	// Replace inline LaTeX delimiters \( \) with $ $
	return blockProcessedContent.replace(/\\\[([\s\S]*?)\\\]/g, (_, equation) => `$${equation}$`)
}

export function Markdown({ content }: { content: string }) {
	const processedContent = preprocessLaTeX(content)

	return (
		<MemoizedReactMarkdown
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
					// If a text link starts with 'citation:', then render it as
					// a citation reference.
					if (
						Array.isArray(children) &&
						typeof children[0] === "string" &&
						children[0].startsWith("citation:")
					) {
						const index = Number(children[0].replace("citation:", ""))

						if (!isNaN(index)) {
							return <SourceNumberButton index={index} />
						}

						// Citation is not looked up yet, don't render anything.
						return null
					}

					return (
						<a href={href} target="_blank" rel="noopener noreferrer">
							{children}
						</a>
					)
				},
			}}>
			{processedContent}
		</MemoizedReactMarkdown>
	)
}
