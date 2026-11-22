import { memo, useEffect } from "react"
import { useRemark } from "react-remark"
import rehypeHighlight, { Options } from "rehype-highlight"
import styled from "styled-components"
import { visit } from "unist-util-visit"
import "./codeblock-parser.css"

export const CODE_BLOCK_BG_COLOR = "#111214"

// Theme-aware background colors for expanded/collapsed states
export const CHAT_ROW_EXPANDED_BG_COLOR = "#111214"

/*
overflowX: auto + inner div with padding results in an issue where the top/left/bottom padding renders but the right padding inside does not count as overflow as the width of the element is not exceeded. Once the inner div is outside the boundaries of the parent it counts as overflow.
https://stackoverflow.com/questions/60778406/why-is-padding-right-clipped-with-overflowscroll/77292459#77292459
this fixes the issue of right padding clipped off 
"ideal" size in a given axis when given infinite available space--allows the syntax highlighter to grow to largest possible width including its padding
minWidth: "max-content",
*/

interface CodeBlockProps {
	source?: string
	forceWrap?: boolean
}

const StyledMarkdown = styled.div<{ forceWrap: boolean }>`
	${({ forceWrap }) =>
		forceWrap &&
		`
    pre, code {
      white-space: pre-wrap;
      word-break: break-all;
      overflow-wrap: anywhere;
    }
  `}

	pre {
		background-color: ${CODE_BLOCK_BG_COLOR};
		border-radius: 8px;
		margin: 0;
		min-width: ${({ forceWrap }) => (forceWrap ? "auto" : "max-content")};
		padding: 13px 16px;
		line-height: 1.6;
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
		font-size: 12.5px;
		font-family: "Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	}

	code:not(pre > code) {
		font-family: "Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		color: #e2e5ea;
	}

	background-color: ${CODE_BLOCK_BG_COLOR};
	font-family: "Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
	font-size: 12.5px;
	color: #d8dbe0;

	p,
	li,
	ol,
	ul {
		line-height: 1.6;
	}
`

const StyledPre = styled.pre<{ theme: any }>`
	& .hljs {
		color: var(--vscode-editor-foreground, #fff);
	}

	${(props) =>
		Object.keys(props.theme)
			.map((key, _index) => {
				return `
      & ${key} {
        color: ${props.theme[key]};
      }
    `
			})
			.join("")}
`

const CodeBlock = memo(({ source, forceWrap = false }: CodeBlockProps) => {
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
				pre: ({ node, ...preProps }: any) => <StyledPre {...preProps} />,
			},
		},
	})

	useEffect(() => {
		setMarkdownSource(source || "")
	}, [source, setMarkdownSource])

	return (
		<div
			style={{
				overflowY: forceWrap ? "visible" : "auto",
				maxHeight: forceWrap ? "none" : "100%",
				backgroundColor: CODE_BLOCK_BG_COLOR,
			}}>
			<StyledMarkdown className="ph-no-capture markdown" forceWrap={forceWrap}>
				{reactContent}
			</StyledMarkdown>
		</div>
	)
})

export default CodeBlock
