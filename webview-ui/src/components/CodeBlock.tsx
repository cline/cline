import React, { useMemo, useState } from "react"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { getLanguageFromPath } from "../utilities/getLanguageFromPath"

interface CodeBlockProps {
	code?: string
	diff?: string
	language?: string | undefined
	path?: string
}

const CodeBlock = ({ code, diff, language, path }: CodeBlockProps) => {
	const [isExpanded, setIsExpanded] = useState(false)

	const backgroundColor = oneDark['pre[class*="language-"]'].background as string

	/*
    We need to remove leading non-alphanumeric characters from the path in order for our leading ellipses trick to work.

    ^: Anchors the match to the start of the string.
    [^a-zA-Z0-9]+: Matches one or more characters that are not alphanumeric.
    The replace method removes these matched characters, effectively trimming the string up to the first alphanumeric character.
    */
	const removeLeadingNonAlphanumeric = (path: string): string => path.replace(/^[^a-zA-Z0-9]+/, "")

	const inferredLanguage = useMemo(
		() => code && (language ?? (path ? getLanguageFromPath(path) : undefined)),
		[path, language, code]
	)

	console.log(inferredLanguage)

	return (
		<div
			style={{
				borderRadius: "3px",
				backgroundColor: backgroundColor,
				overflow: "hidden", // This ensures the inner scrollable area doesn't overflow the rounded corners
			}}>
			{path && (
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						padding: "6px 10px",
						cursor: "pointer",
					}}
					onClick={() => setIsExpanded(!isExpanded)}>
					<span
						style={{
							color: "#BABCC3",
							whiteSpace: "nowrap",
							overflow: "hidden",
							textOverflow: "ellipsis",
							marginRight: "8px",
							fontSize: "11px",
							// trick to get ellipsis at beginning of string
							direction: "rtl",
							textAlign: "left",
						}}>
						{removeLeadingNonAlphanumeric(path) + "\u200E"}
					</span>
					<VSCodeButton appearance="icon" aria-label="Toggle Code" onClick={() => setIsExpanded(!isExpanded)}>
						<span className={`codicon codicon-chevron-${isExpanded ? "up" : "down"}`}></span>
					</VSCodeButton>
				</div>
			)}
			{(!path || isExpanded) && (
				<div
					className="code-block-scrollable"
					style={{
						overflowX: "auto",
						overflowY: "hidden",
						maxWidth: "100%",
					}}>
					<SyntaxHighlighter
						wrapLines={false}
						language={diff ? "diff" : inferredLanguage} // "diff" automatically colors changed lines in green/red
						style={oneDark}
						customStyle={{
							margin: 0,
							padding: "6px 10px",
							borderRadius: 0,
							fontSize: "var(--vscode-editor-font-size)",
							lineHeight: "var(--vscode-editor-line-height)",
						}}>
						{code ?? diff ?? ""}
					</SyntaxHighlighter>
				</div>
			)}
		</div>
	)
}

export default CodeBlock
