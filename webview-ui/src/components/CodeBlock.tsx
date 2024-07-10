import React, { useState } from "react"
import SyntaxHighlighter from "react-syntax-highlighter"
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
/*
const vscodeSyntaxStyle: React.CSSProperties = {
	backgroundColor: "var(--vscode-editor-background)",
	color: "var(--vscode-editor-foreground)",
	fontFamily: "var(--vscode-editor-font-family)",
	fontSize: "var(--vscode-editor-font-size)",
	lineHeight: "var(--vscode-editor-line-height)",
	textAlign: "left",
	whiteSpace: "pre",
	wordSpacing: "normal",
	wordBreak: "normal",
	wordWrap: "normal",
	tabSize: 4,
	hyphens: "none",
	padding: "1em",
	margin: "0.5em 0",
	overflow: "auto",
	borderRadius: "6px",
}

const tokenStyles = {
	comment: { color: "var(--vscode-editor-foreground)" },
	prolog: { color: "var(--vscode-editor-foreground)" },
	doctype: { color: "var(--vscode-editor-foreground)" },
	cdata: { color: "var(--vscode-editor-foreground)" },
	punctuation: { color: "var(--vscode-editor-foreground)" },
	property: { color: "var(--vscode-symbolIcon-propertyForeground)" },
	tag: { color: "var(--vscode-symbolIcon-colorForeground)" },
	boolean: { color: "var(--vscode-symbolIcon-booleanForeground)" },
	number: { color: "var(--vscode-symbolIcon-numberForeground)" },
	constant: { color: "var(--vscode-symbolIcon-constantForeground)" },
	symbol: { color: "var(--vscode-symbolIcon-colorForeground)" },
	selector: { color: "var(--vscode-symbolIcon-colorForeground)" },
	"attr-name": { color: "var(--vscode-symbolIcon-propertyForeground)" },
	string: { color: "var(--vscode-symbolIcon-stringForeground)" },
	char: { color: "var(--vscode-symbolIcon-stringForeground)" },
	builtin: { color: "var(--vscode-symbolIcon-keywordForeground)" },
	inserted: { color: "var(--vscode-gitDecoration-addedResourceForeground)" },
	operator: { color: "var(--vscode-symbolIcon-operatorForeground)" },
	entity: { color: "var(--vscode-symbolIcon-snippetForeground)", cursor: "help" },
	url: { color: "var(--vscode-textLink-foreground)" },
	variable: { color: "var(--vscode-symbolIcon-variableForeground)" },
	atrule: { color: "var(--vscode-symbolIcon-keywordForeground)" },
	"attr-value": { color: "var(--vscode-symbolIcon-stringForeground)" },
	keyword: { color: "var(--vscode-symbolIcon-keywordForeground)" },
	function: { color: "var(--vscode-symbolIcon-functionForeground)" },
	regex: { color: "var(--vscode-symbolIcon-regexForeground)" },
	important: { color: "var(--vscode-editorWarning-foreground)", fontWeight: "bold" },
	bold: { fontWeight: "bold" },
	italic: { fontStyle: "italic" },
	deleted: { color: "var(--vscode-gitDecoration-deletedResourceForeground)" },
}
*/

interface CodeBlockProps {
	code?: string
	diff?: string
	language?: string | undefined
	path?: string
}

const CodeBlock = ({ code, diff, language, path }: CodeBlockProps) => {
	const [isExpanded, setIsExpanded] = useState(false)

	const backgroundColor = oneDark['pre[class*="language-"]'].background as string

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
					}}>
					<span
						style={{
							color: "var(--vscode-descriptionForeground)",
							whiteSpace: "nowrap",
							overflow: "hidden",
							textOverflow: "ellipsis",
							marginRight: "8px",
							// trick to get ellipsis at beginning of string
							direction: "rtl",
							textAlign: "left",
						}}>
						{path}
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
						language={language}
						style={oneDark}
						customStyle={{
							margin: 0,
							padding: "6px 10px",
							borderRadius: 0,
						}}
						lineProps={
							diff != null
								? (lineNumber) => {
										const line = diff?.split("\n")?.[lineNumber - 1]
										let style: React.CSSProperties = { display: "block", width: "100%" }
										if (line && line[0] === "+") {
											style.backgroundColor = "var(--vscode-diffEditor-insertedTextBackground)"
										} else if (line && line[0] === "-") {
											style.backgroundColor = "var(--vscode-diffEditor-removedTextBackground)"
										}
										return { style }
								  }
								: undefined
						}>
						{code ?? diff ?? ""}
					</SyntaxHighlighter>
				</div>
			)}
		</div>
	)
}

export default CodeBlock
