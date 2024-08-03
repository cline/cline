import { useMemo } from "react"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { getLanguageFromPath } from "../../utils/getLanguageFromPath"
import { SyntaxHighlighterStyle } from "../../utils/getSyntaxHighlighterStyleFromTheme"

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
	syntaxHighlighterStyle: SyntaxHighlighterStyle
	isExpanded: boolean
	onToggleExpand: () => void
}

const CodeBlock = ({
	code,
	diff,
	language,
	path,
	syntaxHighlighterStyle,
	isExpanded,
	onToggleExpand,
}: CodeBlockProps) => {
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

	return (
		<div
			style={{
				borderRadius: "3px",
				backgroundColor: "var(--vscode-editor-background)",
				overflow: "hidden", // This ensures the inner scrollable area doesn't overflow the rounded corners
				border: "1px solid var(--vscode-editorGroup-border)",
			}}>
			{path && (
				<div
					style={{
						color: "var(--vscode-descriptionForeground)",
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						padding: "6px 10px",
						cursor: "pointer",
					}}
					onClick={onToggleExpand}>
					<span
						style={{
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
					<span className={`codicon codicon-chevron-${isExpanded ? "up" : "down"}`}></span>
				</div>
			)}
			{(!path || isExpanded) && (
				<div
					//className="code-block-scrollable" this doesn't seem to be necessary anymore, on silicon macs it shows the native mac scrollbar instead of the vscode styled one
					style={{
						overflowX: "auto",
						overflowY: "hidden",
						maxWidth: "100%",
					}}>
					<SyntaxHighlighter
						wrapLines={false}
						language={diff ? "diff" : inferredLanguage} // "diff" automatically colors changed lines in green/red
						style={{
							...syntaxHighlighterStyle,
							// Our syntax highlighter style doesn't always match the vscode theme 1:1, so we'll apply sensible styles here that vscode exposes to us
							'code[class*="language-"]': {
								background: "var(--vscode-editor-background)",
							},
							'pre[class*="language-"]': {
								background: "var(--vscode-editor-background)",
							},
						}}
						customStyle={{
							margin: 0,
							padding: "6px 10px",
							/*
							overflowX: auto + inner div with padding results in an issue where the top/left/bottom padding renders but the right padding inside does not count as overflow as the width of the element is not exceeded. Once the inner div is outside the boundaries of the parent it counts as overflow.
							https://stackoverflow.com/questions/60778406/why-is-padding-right-clipped-with-overflowscroll/77292459#77292459
							this fixes the issue of right padding clipped off 
							“ideal” size in a given axis when given infinite available space--allows the syntax highlighter to grow to largest possible width including its padding
							*/
							minWidth: "max-content",
							borderRadius: 0,
							fontSize: "var(--vscode-editor-font-size)",
							lineHeight: "var(--vscode-editor-line-height)",
							fontFamily: "var(--vscode-editor-font-family)",
						}}>
						{code ?? diff ?? ""}
					</SyntaxHighlighter>
				</div>
			)}
		</div>
	)
}

export default CodeBlock
