import { memo } from "react"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism"
import styled from "styled-components"

export const CODE_BLOCK_BG_COLOR = "var(--vscode-editor-background, --vscode-sideBar-background, rgb(30 30 30))"

interface DiffCodeBlockProps {
	source?: string
	language?: string
	showLineNumbers?: boolean
}

const CodeContainer = styled.div`
	margin: 1rem 0;
	border-radius: 8px;
	overflow: hidden;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
`

const StyledPre = styled.pre`
	margin: 0 !important;
	padding: 1rem !important;
	background: ${CODE_BLOCK_BG_COLOR} !important;

	/* Diff line styling */
	.token.deleted {
		background-color: var(--vscode-diffEditor-removedTextBackground, rgba(255, 0, 0, 0.2));
		color: var(--vscode-diffEditor-removedTextForeground, #ff6b6b);
	}

	.token.inserted {
		background-color: var(--vscode-diffEditor-insertedTextBackground, rgba(0, 255, 0, 0.2));
		color: var(--vscode-diffEditor-insertedTextForeground, #51cf66);
	}

	.token.coord {
		color: var(--vscode-diffEditor-diagonalFill, #74c0fc);
		font-weight: bold;
	}

	/* Custom diff styling */
	.diff-line-removed {
		background-color: var(--vscode-diffEditor-removedTextBackground, rgba(255, 0, 0, 0.2));
		color: var(--vscode-diffEditor-removedTextForeground, #ff6b6b);
		display: block;
		width: 100%;
		padding: 0 4px;
		margin: 0 -4px;
	}

	.diff-line-added {
		background-color: var(--vscode-diffEditor-insertedTextBackground, rgba(0, 255, 0, 0.2));
		color: var(--vscode-diffEditor-insertedTextForeground, #51cf66);
		display: block;
		width: 100%;
		padding: 0 4px;
		margin: 0 -4px;
	}

	.diff-line-meta {
		color: var(--vscode-diffEditor-diagonalFill, #74c0fc);
		font-weight: bold;
	}
`

const DiffCodeBlock = memo(({ source, language = "diff", showLineNumbers = true }: DiffCodeBlockProps) => {
	return (
		<CodeContainer>
			<SyntaxHighlighter
				language={language}
				style={vscDarkPlus}
				showLineNumbers={showLineNumbers}
				customStyle={{
					margin: 0,
					padding: "1rem",
					background: CODE_BLOCK_BG_COLOR,
				}}
				PreTag={StyledPre}>
				{source || ""}
			</SyntaxHighlighter>
		</CodeContainer>
	)
})

export default DiffCodeBlock
