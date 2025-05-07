import React from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

interface VSCodeButtonLinkProps {
	href: string
	children: React.ReactNode
	[key: string]: any
}

export const VSCodeButtonLink = ({ href, children, ...props }: VSCodeButtonLinkProps) => (
	<a href={href} className="no-underline text-inherit">
		<VSCodeButton {...props}>{children}</VSCodeButton>
	</a>
)
