import React from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

interface VSCodeButtonLinkProps {
	href: string
	children: React.ReactNode
	[key: string]: any
}

const VSCodeButtonLink: React.FC<VSCodeButtonLinkProps> = ({ href, children, ...props }) => {
	return (
		<a
			href={href}
			style={{
				textDecoration: "none",
				color: "inherit",
			}}>
			<VSCodeButton {...props}>{children}</VSCodeButton>
		</a>
	)
}

export default VSCodeButtonLink
