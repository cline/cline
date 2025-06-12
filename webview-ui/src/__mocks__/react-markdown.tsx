import React from "react"

interface ReactMarkdownProps {
	children?: React.ReactNode
	className?: string
	remarkPlugins?: any[]
	components?: any
}

const ReactMarkdown: React.FC<ReactMarkdownProps> = ({ children, className }) => {
	return (
		<div className={className} data-testid="mock-react-markdown">
			{children}
		</div>
	)
}

export default ReactMarkdown
export type { ReactMarkdownProps as Options }
