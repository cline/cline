import * as React from "react"

interface CodeBlockProps {
	children?: React.ReactNode
	language: string
}

const CodeBlock: React.FC<CodeBlockProps> = () => <div data-testid="mock-code-block">Mocked Code Block</div>

export default CodeBlock
