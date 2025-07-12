import React from "react"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism"
import styled from "styled-components"

const CodeContainer = styled.div`
	margin: 1rem 0;
	border-radius: 8px;
	overflow: hidden;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
`

const StyledPre = styled.pre`
	margin: 0 !important;
	padding: 1rem !important;
	background: #1e1e1e !important;

	/* Diff line styling */
	.token.deleted {
		background-color: rgba(255, 0, 0, 0.2);
		color: #ff6b6b;
	}

	.token.inserted {
		background-color: rgba(0, 255, 0, 0.2);
		color: #51cf66;
	}

	.token.coord {
		color: #74c0fc;
		font-weight: bold;
	}

	/* Custom diff styling */
	.diff-line-removed {
		background-color: rgba(255, 0, 0, 0.2);
		color: #ff6b6b;
		display: block;
		width: 100%;
		padding: 0 4px;
		margin: 0 -4px;
	}

	.diff-line-added {
		background-color: rgba(0, 255, 0, 0.2);
		color: #51cf66;
		display: block;
		width: 100%;
		padding: 0 4px;
		margin: 0 -4px;
	}

	.diff-line-meta {
		color: #74c0fc;
		font-weight: bold;
	}
`

interface CodeBlockProps {
	code: string
	language?: string
	showLineNumbers?: boolean
}

export const CodeBlockSyntax: React.FC<CodeBlockProps> = ({ code, language = "diff", showLineNumbers = true }) => {
	return (
		<CodeContainer>
			<SyntaxHighlighter
				language={language}
				style={vscDarkPlus}
				showLineNumbers={showLineNumbers}
				customStyle={{
					margin: 0,
					padding: "1rem",
					background: "#1e1e1e",
				}}
				PreTag={StyledPre}>
				{code}
			</SyntaxHighlighter>
		</CodeContainer>
	)
}
