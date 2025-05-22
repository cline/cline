import React, { memo, useEffect, useRef, useState } from "react"
import type { ComponentProps } from "react"
import { useRemark } from "react-remark"
import rehypeHighlight, { Options } from "rehype-highlight"
import rehypeKatex from "rehype-katex"
import remarkMath from "remark-math"
import styled from "styled-components"
import { visit } from "unist-util-visit"
import type { Node } from "unist"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import MermaidBlock from "@/components/common/MermaidBlock"
import { StateServiceClient } from "@/services/grpc-client"
import { PlanActMode } from "@shared/proto/state"

// Styled component for Act Mode text with more specific styling
const ActModeHighlight: React.FC = () => (
	<span
		onClick={() => {
			StateServiceClient.togglePlanActMode({
				chatSettings: {
					mode: PlanActMode.ACT,
				},
			})
		}}
		title="Click to toggle to Act Mode"
		className="text-[var(--vscode-textLink-foreground)] hover:opacity-90 cursor-pointer inline-flex items-center gap-1">
		<div className="p-1 rounded-[12px] bg-[var(--vscode-editor-background)] flex items-center justify-end w-4 border-[1px] border-[var(--vscode-input-border)]">
			<div className="rounded-full bg-[var(--vscode-textLink-foreground)] w-2 h-2" />
		</div>
		Act Mode (⌘⇧A)
	</span>
)

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
	return (tree: Node) => {
		// Visit all "text" nodes in the markdown AST (Abstract Syntax Tree)
		visit(tree, "text", (node: any, index, parent) => {
			const urlRegex = /https?:\/\/[^\s<>)"]+/g
			const matches = node.value.match(urlRegex)
			if (!matches) return

			const parts = node.value.split(urlRegex)
			const children: any[] = []

			parts.forEach((part: string, i: number) => {
				if (part) children.push({ type: "text", value: part })
				if (matches[i]) {
					children.push({
						type: "link",
						url: matches[i],
						children: [{ type: "text", value: matches[i] }],
					})
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

/**
 * Custom remark plugin that highlights "to Act Mode" mentions and adds keyboard shortcut hint
 */
const remarkHighlightActMode = () => {
	return (tree: Node) => {
		visit(tree, "text", (node: any, index, parent) => {
			// Case-insensitive regex to match "to Act Mode" in various capitalizations
			// Using word boundaries to avoid matching within words
			// Added negative lookahead to avoid matching if already followed by the shortcut
			const actModeRegex = /\bto\s+Act\s+Mode\b(?!\s*\(⌘⇧A\))/i

			if (!node.value.match(actModeRegex)) return

			// Split the text by the matches
			const parts = node.value.split(actModeRegex)
			const matches = node.value.match(actModeRegex)

			if (!matches || parts.length <= 1) return

			const children: any[] = []

			parts.forEach((part: string, i: number) => {
				// Add the text before the match
				if (part) children.push({ type: "text", value: part })

				// Add the match, but only make "Act Mode" bold (not the "to" part)
				if (matches[i]) {
					// Extract "to" and "Act Mode" parts
					const matchText = matches[i]
					const toIndex = matchText.toLowerCase().indexOf("to")
					const actModeIndex = matchText.toLowerCase().indexOf("act mode", toIndex + 2)

					if (toIndex !== -1 && actModeIndex !== -1) {
						// Add "to" as regular text
						const toPart = matchText.substring(toIndex, actModeIndex).trim()
						children.push({ type: "text", value: toPart + " " })

						// Add "Act Mode" as bold with keyboard shortcut
						const actModePart = matchText.substring(actModeIndex)
						children.push({
							type: "strong",
							children: [{ type: "text", value: `${actModePart} (⌘⇧A)` }],
						})
					} else {
						// Fallback if we can't parse it correctly
						children.push({ type: "text", value: matchText + " " })
						children.push({
							type: "strong",
							children: [{ type: "text", value: `(⌘⇧A)` }],
						})
					}
				}
			})

			// Replace the original text node with our new nodes
			if (parent) {
				parent.children.splice(index, 1, ...children)
			}
		})
	}
}

/**
 * Custom remark plugin that prevents filenames with extensions from being parsed as bold text
 * For example: __init__.py should not be rendered as bold "init" followed by ".py"
 * Solves https://github.com/cline/cline/issues/1028
 */
const remarkPreventBoldFilenames = () => {
	return (tree: any) => {
		visit(tree, "strong", (node: any, index: number | undefined, parent: any) => {
			// Only process if there's a next node (potential file extension)
			if (!parent || typeof index === "undefined" || index === parent.children.length - 1) return

			const nextNode = parent.children[index + 1]

			// Check if next node is text and starts with . followed by extension
			if (nextNode.type !== "text" || !nextNode.value.match(/^\.[a-zA-Z0-9]+/)) return

			// If the strong node has multiple children, something weird is happening
			if (node.children?.length !== 1) return

			// Get the text content from inside the strong node
			const strongContent = node.children?.[0]?.value
			if (!strongContent || typeof strongContent !== "string") return

			// Validate that the strong content is a valid filename
			if (!strongContent.match(/^[a-zA-Z0-9_-]+$/)) return

			// Combine into a single text node
			const newNode = {
				type: "text",
				value: `__${strongContent}__${nextNode.value}`,
			}

			// Replace both nodes with the combined text node
			parent.children.splice(index, 2, newNode)
		})
	}
}

import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

const CopyButton = styled(VSCodeButton)`
	position: absolute;
	top: 5px;
	right: 5px;
	z-index: 1;
	opacity: 0;
`

const CodeBlockContainer = styled.div`
	position: relative;

	&:hover ${CopyButton} {
		opacity: 1;
	}
`

const StyledMarkdown = styled.div`
	pre {
		background-color: ${CODE_BLOCK_BG_COLOR};
		border-radius: 3px;
		margin: 13px 0;
		padding: 10px 10px;
		max-width: calc(100vw - 20px);
		overflow-x: auto;
		overflow-y: hidden;
		padding-right: 70px;
	}

	pre > code {
		.hljs-deletion {
			background-color: var(--vscode-diffEditor-removedTextBackground);
			display: inline-block;
			width: 100%;
		}
		.hljs-addition {
			background-color: var(--vscode-diffEditor-insertedTextBackground);
			display: inline-block;
			width: 100%;
		}
	}

	code {
		span.line:empty {
			display: none;
		}
		word-wrap: break-word;
		border-radius: 3px;
		background-color: ${CODE_BLOCK_BG_COLOR};
		font-size: var(--vscode-editor-font-size, var(--vscode-font-size, 12px));
		font-family: var(--vscode-editor-font-family);
	}

	code:not(pre > code) {
		font-family: var(--vscode-editor-font-family, monospace);
		color: var(--vscode-textPreformat-foreground, #f78383);
		background-color: var(--vscode-textCodeBlock-background, #1e1e1e);
		padding: 0px 2px;
		border-radius: 3px;
		border: 1px solid var(--vscode-textSeparator-foreground, #424242);
		white-space: pre-line;
		word-break: break-word;
		overflow-wrap: anywhere;
	}

	/* KaTeX styling */
	.katex {
		font-size: 1.1em;
		color: var(--vscode-editor-foreground);
		font-family: KaTeX_Main, "Times New Roman", serif;
		line-height: 1.2;
		white-space: normal;
		text-indent: 0;
	}

	.katex-display {
		display: block;
		margin: 1em 0;
		text-align: center;
		padding: 0.5em;
		overflow-x: auto;
		overflow-y: hidden;
		background-color: var(--vscode-textCodeBlock-background);
		border-radius: 3px;
	}

	.katex-error {
		color: var(--vscode-errorForeground);
		border: 1px solid var(--vscode-inputValidation-errorBorder);
		padding: 8px;
		border-radius: 3px;
	}

	font-family:
		var(--vscode-font-family),
		system-ui,
		-apple-system,
		BlinkMacSystemFont,
		"Segoe UI",
		Roboto,
		Oxygen,
		Ubuntu,
		Cantarell,
		"Open Sans",
		"Helvetica Neue",
		sans-serif;
	font-size: var(--vscode-font-size, 13px);

	p,
	li,
	ol,
	ul {
		line-height: 1.25;
	}

	ol,
	ul {
		padding-left: 2.5em;
		margin-left: 0;
	}

	p {
		white-space: pre-wrap;
	}

	a {
		text-decoration: none;
	}
	a {
		&:hover {
			text-decoration: underline;
		}
	}
`

const StyledPre = styled.pre<{ theme: any }>`
	& .hljs {
		color: var(--vscode-editor-foreground, #fff);
	}

	${(props) =>
		Object.keys(props.theme)
			.map((key, index) => {
				return `
      & ${key} {
        color: ${props.theme[key]};
      }
    `
			})
			.join("")}
`

const PreWithCopyButton = ({
	children,
	theme,
	...preProps
}: { theme: Record<string, string> } & React.HTMLAttributes<HTMLPreElement>) => {
	const preRef = useRef<HTMLPreElement>(null)
	const [copied, setCopied] = useState(false)

	const handleCopy = () => {
		if (preRef.current) {
			const codeElement = preRef.current.querySelector("code")
			const textToCopy = codeElement ? codeElement.textContent : preRef.current.textContent

			if (!textToCopy) return
			navigator.clipboard.writeText(textToCopy).then(() => {
				setCopied(true)
				setTimeout(() => setCopied(false), 1500)
			})
		}
	}

	return (
		<CodeBlockContainer>
			<CopyButton appearance="icon" onClick={handleCopy} aria-label={copied ? "Copied" : "Copy"}>
				<span className={`codicon codicon-${copied ? "check" : "copy"}`}></span>
			</CopyButton>
			<StyledPre {...preProps} theme={theme} ref={preRef}>
				{children}
			</StyledPre>
		</CodeBlockContainer>
	)
}

const MarkdownBlock = memo(({ markdown }: MarkdownBlockProps) => {
	const { theme } = useExtensionState()

	const [reactContent, setMarkdown] = useRemark({
		remarkPlugins: [
			remarkPreventBoldFilenames,
			remarkUrlToLink,
			remarkHighlightActMode,
			remarkMath,
			() => {
				return (tree) => {
					visit(tree, "code", (node: any) => {
						if (!node.lang) {
							node.lang = "javascript"
						} else if (node.lang.includes(".")) {
							node.lang = node.lang.split(".").slice(-1)[0]
						}
					})
				}
			},
		],
		rehypePlugins: [
			rehypeHighlight as any,
			{
				// languages: {},
			} as Options,
			rehypeKatex,
		],
		rehypeReactOptions: {
			components: {
				pre: ({ children, ...preProps }: React.HTMLAttributes<HTMLPreElement>) => {
					if (Array.isArray(children) && children.length === 1 && React.isValidElement(children[0])) {
						const child = children[0] as React.ReactElement<{ className?: string }>
						if (child.props?.className?.includes("language-mermaid")) {
							return child
						}
					}
					return (
						<PreWithCopyButton {...preProps} theme={theme || {}}>
							{children}
						</PreWithCopyButton>
					)
				},
				code: (props: ComponentProps<"code">) => {
					const className = props.className || ""
					if (className.includes("language-mermaid")) {
						const codeText = String(props.children || "")
						return <MermaidBlock code={codeText} />
					}
					return <code {...props} />
				},
				strong: (props: ComponentProps<"strong">) => {
					// Check if this is an "Act Mode" strong element by looking for the keyboard shortcut
					// Handle both string children and array of children cases
					const childrenText = React.Children.toArray(props.children)
						.map((child) => {
							if (typeof child === "string") return child
							if (typeof child === "object" && "props" in child && child.props.children)
								return String(child.props.children)
							return ""
						})
						.join("")

					// Case-insensitive check for "Act Mode (⌘⇧A)" pattern
					// This ensures we only style the exact "Act Mode" mentions with keyboard shortcut
					// Using case-insensitive flag to catch all capitalization variations
					if (/^act mode\s*\(⌘⇧A\)$/i.test(childrenText)) {
						return <ActModeHighlight />
					}

					return <strong {...props} />
				},
			},
		},
	})

	useEffect(() => {
		setMarkdown(markdown || "")
	}, [markdown, setMarkdown, theme])

	return (
		<div>
			<StyledMarkdown className="ph-no-capture">{reactContent}</StyledMarkdown>
		</div>
	)
})

export default MarkdownBlock
