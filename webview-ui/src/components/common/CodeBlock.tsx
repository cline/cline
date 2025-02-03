import { memo, useEffect, useRef, useState } from "react"
import { useRemark } from "react-remark"
import rehypeHighlight, { Options } from "rehype-highlight"
import styled from "styled-components"
import { visit } from "unist-util-visit"
import { useExtensionState } from "../../context/ExtensionStateContext"

export const CODE_BLOCK_BG_COLOR = "var(--vscode-editor-background, --vscode-sideBar-background, rgb(30 30 30))"

/*
overflowX: auto + inner div with padding results in an issue where the top/left/bottom padding renders but the right padding inside does not count as overflow as the width of the element is not exceeded. Once the inner div is outside the boundaries of the parent it counts as overflow.
https://stackoverflow.com/questions/60778406/why-is-padding-right-clipped-with-overflowscroll/77292459#77292459
this fixes the issue of right padding clipped off 
“ideal” size in a given axis when given infinite available space--allows the syntax highlighter to grow to largest possible width including its padding
minWidth: "max-content",
*/

interface CodeBlockProps {
	source?: string
	language?: string
	preStyle?: React.CSSProperties
}

const CopyButton = styled.button`
	background: transparent;
	border: none;
	color: var(--vscode-foreground);
	cursor: pointer;
	padding: 4px;
	display: flex;
	align-items: center;
	opacity: 0.4;
	transition: opacity 0.2s;
	border-radius: 3px;
	pointer-events: all;

	&:hover {
		background: var(--vscode-toolbar-hoverBackground);
		opacity: 1;
	}
`

const CopyButtonWrapper = styled.div`
	position: fixed;
	top: var(--copy-button-top);
	right: var(--copy-button-right, 8px);
	height: 0;
	z-index: 100;
	background: ${CODE_BLOCK_BG_COLOR};
	overflow: visible;
	pointer-events: none;
	opacity: var(--copy-button-opacity, 0);
	transition:
		opacity 0.2s,
		background 0.2s;
	padding: 4px;
	border-radius: 3px;

	&:hover {
		background: var(--vscode-editor-background);
	}

	${CopyButton} {
		position: relative;
		top: 0;
		right: 0;
		pointer-events: all;
	}
`

const CodeBlockContainer = styled.div`
	position: relative;
	overflow: hidden;
	background-color: ${CODE_BLOCK_BG_COLOR};

	&:hover ${CopyButtonWrapper} {
		opacity: 1 !important;
	}
`

const StyledMarkdown = styled.div<{ preStyle?: React.CSSProperties; wordwrap?: boolean }>`
	overflow-x: auto;
	width: 100%;

	pre {
		background-color: ${CODE_BLOCK_BG_COLOR};
		border-radius: 5px;
		margin: 0;
		padding: 10px 10px;
		display: block;
		box-sizing: border-box;
		width: 100%;
		${({ preStyle }) => preStyle && { ...preStyle }}
	}

	pre,
	code {
		white-space: ${({ wordwrap }) => (wordwrap === false ? "pre" : "pre-wrap")};
		word-break: ${({ wordwrap }) => (wordwrap === false ? "normal" : "normal")};
		overflow-wrap: ${({ wordwrap }) => (wordwrap === false ? "normal" : "break-word")};
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
		border-radius: 5px;
		background-color: ${CODE_BLOCK_BG_COLOR};
		font-size: var(--vscode-editor-font-size, var(--vscode-font-size, 12px));
		font-family: var(--vscode-editor-font-family);
	}

	code:not(pre > code) {
		font-family: var(--vscode-editor-font-family);
		color: #f78383;
	}

	background-color: ${CODE_BLOCK_BG_COLOR};
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
	font-size: var(--vscode-editor-font-size, var(--vscode-font-size, 12px));
	color: var(--vscode-editor-foreground, #fff);

	p,
	li,
	ol,
	ul {
		line-height: 1.5;
	}
`

export const StyledPre = styled.pre<{ theme: any }>`
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

const CodeBlock = memo(({ source, language, preStyle }: CodeBlockProps) => {
	const codeBlockRef = useRef<HTMLDivElement>(null)
	const [copied, setCopied] = useState(false)
	const { theme } = useExtensionState()

	const [reactContent, setMarkdownSource] = useRemark({
		remarkPlugins: [
			() => {
				return (tree) => {
					visit(tree, "code", (node: any) => {
						if (!node.lang) {
							node.lang = "javascript"
						} else if (node.lang.includes(".")) {
							// if the language is a file, get the extension
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
		],
		rehypeReactOptions: {
			components: {
				pre: ({ node, ...preProps }: any) => <StyledPre {...preProps} theme={theme} />,
			},
		},
	})

	const updateCopyButtonPosition = (forceShow = false) => {
		const codeBlock = codeBlockRef.current
		if (!codeBlock) return

		const rect = codeBlock.getBoundingClientRect()
		const scrollContainer = document.querySelector('[data-virtuoso-scroller="true"]')
		if (!scrollContainer) return

		const scrollRect = scrollContainer.getBoundingClientRect()
		const isVisible = rect.top >= scrollRect.top && rect.bottom <= scrollRect.bottom
		const isPartiallyVisible = rect.top < scrollRect.bottom && rect.bottom >= scrollRect.top

		// Only show when code block is in view
		codeBlock.style.setProperty("--copy-button-opacity", isPartiallyVisible || forceShow ? "1" : "0")

		if (isPartiallyVisible) {
			// Keep button within code block bounds
			const topPosition = Math.max(scrollRect.top + 8, Math.min(rect.bottom - 40, rect.top + 8))
			const rightPosition = Math.max(8, scrollRect.right - rect.right + 8)

			codeBlock.style.setProperty("--copy-button-top", `${topPosition}px`)
			codeBlock.style.setProperty("--copy-button-right", `${rightPosition}px`)
		}
	}

	useEffect(() => {
		const handleScroll = () => updateCopyButtonPosition()
		const handleResize = () => updateCopyButtonPosition()

		const scrollContainer = document.querySelector('[data-virtuoso-scroller="true"]')
		if (scrollContainer) {
			scrollContainer.addEventListener("scroll", handleScroll)
			window.addEventListener("resize", handleResize)
			updateCopyButtonPosition()
		}

		return () => {
			if (scrollContainer) {
				scrollContainer.removeEventListener("scroll", handleScroll)
				window.removeEventListener("resize", handleResize)
			}
		}
	}, [])

	// Update button position when content changes
	useEffect(() => {
		if (reactContent) {
			// Small delay to ensure content is rendered
			setTimeout(() => updateCopyButtonPosition(), 0)
		}
	}, [reactContent])

	const handleCopy = (e: React.MouseEvent) => {
		e.stopPropagation()
		if (source) {
			// Extract code content from markdown code block
			const codeContent = source.replace(/^```[\s\S]*?\n([\s\S]*?)```$/m, "$1").trim()
			navigator.clipboard.writeText(codeContent)
			setCopied(true)
			setTimeout(() => setCopied(false), 2000)
		}
	}

	useEffect(() => {
		const markdown = language ? `\`\`\`${language}\n${source || ""}\`\`\`` : source || ""
		setMarkdownSource(markdown)
	}, [source, language, setMarkdownSource, theme])

	return (
		<CodeBlockContainer ref={codeBlockRef}>
			<StyledMarkdown preStyle={preStyle} wordwrap={true}>
				{reactContent}
			</StyledMarkdown>
			<CopyButtonWrapper
				onMouseEnter={() => updateCopyButtonPosition(true)}
				onMouseLeave={() => updateCopyButtonPosition()}>
				<CopyButton onClick={handleCopy} title="Copy code">
					<span className={`codicon codicon-${copied ? "check" : "copy"}`} />
				</CopyButton>
			</CopyButtonWrapper>
		</CodeBlockContainer>
	)
})

export default CodeBlock
