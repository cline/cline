import React, { memo, useEffect, FC, PropsWithChildren } from "react"
import { useRemark } from "react-remark"
import { visit } from "unist-util-visit"

import { vscode } from "@src/utils/vscode"
import { useExtensionState } from "@src/context/ExtensionStateContext"

import CodeBlock from "./CodeBlock"
import MermaidBlock from "./MermaidBlock"

interface MarkdownBlockProps {
	markdown?: string
}

/**
 * Custom remark plugin that converts plain URLs in text into clickable links
 *
 * The original bug: We were converting text nodes into paragraph nodes,
 * which broke the markdown structure because text nodes should remain as text nodes
 * within their parent elements (like paragraphs, list items, etc.).
 * This caused the entire content to disappear because the structure became invalid.
 */
const remarkUrlToLink = () => {
	return (tree: any) => {
		// Visit all "text" nodes in the markdown AST (Abstract Syntax Tree)
		visit(tree, "text", (node: any, index, parent) => {
			const urlRegex = /https?:\/\/[^\s<>)"]+/g
			const matches = node.value.match(urlRegex)

			if (!matches) {
				return
			}

			const parts = node.value.split(urlRegex)
			const children: any[] = []

			parts.forEach((part: string, i: number) => {
				if (part) {
					children.push({ type: "text", value: part })
				}

				if (matches[i]) {
					children.push({ type: "link", url: matches[i], children: [{ type: "text", value: matches[i] }] })
				}
			})

			// Fix: Instead of converting the node to a paragraph (which broke things),
			// we replace the original text node with our new nodes in the parent's children array.
			// This preserves the document structure while adding our links.
			if (parent) {
				parent.children.splice(index, 1, ...children)
			}
		})
	}
}

const StyledMarkdown: FC<PropsWithChildren<unknown>> = ({ children }) => {
	// Note: Tailwind doesn't have a direct equivalent for targeting based on body data attributes like `body[data-vscode-theme-kind="vscode-high-contrast"]`.
	// This specific high-contrast styling might need to be handled differently, possibly via a theme-aware context or by adding a class to this component when high contrast is active.
	// For now, the general styles are applied.
	return (
		<div
			className="
				font-vscode-font-family
				text-vscode-font-size
				[&_p]:leading-tight
				[&_li]:leading-tight
				[&_ol]:leading-tight
				[&_ul]:leading-tight
				[&_ol]:pl-[2.5em]
				[&_ul]:pl-[2.5em]
				[&_ol]:ml-0
				[&_ul]:ml-0
				[&_p]:whitespace-pre-wrap
				[&_a]:text-vscode-textLink-foreground
				[&_a]:underline
				[&_a]:decoration-dotted
				[&_a]:decoration-vscode-textLink-foreground
				hover:[&_a]:text-vscode-textLink-activeForeground
				hover:[&_a]:decoration-solid
				hover:[&_a]:decoration-vscode-textLink-activeForeground
				[&_code:not(pre>code)]:font-vscode-editor-font-family
				[&_code:not(pre>code)]:saturate-[1.1]
				[&_code:not(pre>code)]:brightness-95
				[&_code:not(pre>code)]:text-vscode-textPreformat-foreground!
				[&_code:not(pre>code)]:bg-vscode-textPreformat-background!
				[&_code:not(pre>code)]:px-[2px]
				[&_code:not(pre>code)]:whitespace-pre-line
				[&_code:not(pre>code)]:break-words
				[&_code:not(pre>code)]:overflow-wrap-anywhere
			">
			{children}
		</div>
	)
}

const MarkdownBlock = memo(({ markdown }: MarkdownBlockProps) => {
	const { theme } = useExtensionState()
	const [reactContent, setMarkdown] = useRemark({
		remarkPlugins: [
			remarkUrlToLink,
			() => {
				return (tree) => {
					visit(tree, "code", (node: any) => {
						if (!node.lang) {
							node.lang = "text"
						} else if (node.lang.includes(".")) {
							node.lang = node.lang.split(".").slice(-1)[0]
						}
					})
				}
			},
		],
		rehypePlugins: [],
		rehypeReactOptions: {
			components: {
				a: ({ href, children }: any) => {
					return (
						<a
							href={href}
							title={href}
							onClick={(e) => {
								// Only process file:// protocol or local file paths
								const isLocalPath =
									href.startsWith("file://") || href.startsWith("/") || !href.includes("://")

								if (!isLocalPath) {
									return
								}

								e.preventDefault()

								// Handle absolute vs project-relative paths
								let filePath = href.replace("file://", "")

								// Extract line number if present
								const match = filePath.match(/(.*):(\d+)(-\d+)?$/)
								let values = undefined
								if (match) {
									filePath = match[1]
									values = { line: parseInt(match[2]) }
								}

								// Add ./ prefix if needed
								if (!filePath.startsWith("/") && !filePath.startsWith("./")) {
									filePath = "./" + filePath
								}

								vscode.postMessage({
									type: "openFile",
									text: filePath,
									values,
								})
							}}>
							{children}
						</a>
					)
				},
				pre: ({ node: _, children }: any) => {
					// Check for Mermaid diagrams first
					if (Array.isArray(children) && children.length === 1 && React.isValidElement(children[0])) {
						const child = children[0] as React.ReactElement<{ className?: string }>

						if (child.props?.className?.includes("language-mermaid")) {
							return child
						}
					}

					// For all other code blocks, use CodeBlock with copy button
					const codeNode = children?.[0]

					if (!codeNode?.props?.children) {
						return null
					}

					const language =
						(Array.isArray(codeNode.props?.className)
							? codeNode.props.className
							: [codeNode.props?.className]
						).map((c: string) => c?.replace("language-", ""))[0] || "javascript"

					const rawText = codeNode.props.children[0] || ""
					return <CodeBlock source={rawText} language={language} />
				},
				code: (props: any) => {
					const className = props.className || ""

					if (className.includes("language-mermaid")) {
						const codeText = String(props.children || "")
						return <MermaidBlock code={codeText} />
					}

					return <code {...props} />
				},
			},
		},
	})

	useEffect(() => {
		setMarkdown(markdown || "")
	}, [markdown, setMarkdown, theme])

	return (
		<div>
			<StyledMarkdown>{reactContent}</StyledMarkdown>
		</div>
	)
})

export default MarkdownBlock
