import * as React from "react"

interface CodeBlockProps {
	source?: string
	language?: string
}

const CodeBlock: React.FC<CodeBlockProps> = ({ source = "" }) => <div data-testid="mock-code-block">{source}</div>

export default CodeBlock
