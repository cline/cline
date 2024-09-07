import { memo, useEffect } from "react"
import { useRemark } from "react-remark"
import rehypeHighlight, { Options } from "rehype-highlight"
import styled from "styled-components"
import { visit } from "unist-util-visit"
import { useExtensionState } from "../context/ExtensionStateContext"

const BG_COLOR = "var(--vscode-editor-background, --vscode-sideBar-background, rgb(30 30 30))"

/*
overflowX: auto + inner div with padding results in an issue where the top/left/bottom padding renders but the right padding inside does not count as overflow as the width of the element is not exceeded. Once the inner div is outside the boundaries of the parent it counts as overflow.
https://stackoverflow.com/questions/60778406/why-is-padding-right-clipped-with-overflowscroll/77292459#77292459
this fixes the issue of right padding clipped off 
“ideal” size in a given axis when given infinite available space--allows the syntax highlighter to grow to largest possible width including its padding
minWidth: "max-content",
*/

const StyledMarkdown = styled.div`
	pre {
		background-color: ${BG_COLOR};
		border-radius: 5px;
		margin: 0;
		min-width: max-content;
		padding: 10px 10px;
	}

	pre > code {
		.hljs-deletion {
			background-color: var(--vscode-diffEditor-removedTextBackground);
		}
		.hljs-addition {
			background-color: var(--vscode-diffEditor-insertedTextBackground);
		}
	}

	code {
		span.line:empty {
			display: none;
		}
		word-wrap: break-word;
		border-radius: 5px;
		background-color: ${BG_COLOR};
		font-size: var(--vscode-editor-font-size, var(--vscode-font-size, 12px));
		font-family: var(--vscode-editor-font-family);
	}

	code:not(pre > code) {
		font-family: var(--vscode-editor-font-family);
		color: #f78383;
	}

	background-color: ${BG_COLOR};
	font-family: var(--vscode-font-family), system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen,
		Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
	font-size: var(--vscode-editor-font-size, var(--vscode-font-size, 12px));
	color: var(--vscode-editor-foreground, #fff);

	p,
	li,
	ol,
	ul {
		line-height: 1.5;
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

const CodeBlock = memo(({ source }: { source?: string }) => {
	const { theme } = useExtensionState()
	const [reactContent, setMarkdownSource] = useRemark({
		remarkPlugins: [
			() => {
				return (tree) => {
					visit(tree, "code", (node: any) => {
						if (!node.lang) {
							node.lang = "javascript"
						} else if (node.lang.includes(".")) {
							// if the langauge is a file, get the extension
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

	useEffect(() => {
		setMarkdownSource(source || "")
	}, [source, setMarkdownSource, theme])

	return (
		<div
			style={{
				overflowY: "auto",
				maxHeight: "100%",
				backgroundColor: BG_COLOR,
			}}>
			<StyledMarkdown>{reactContent}</StyledMarkdown>
		</div>
	)
})

export default CodeBlock
