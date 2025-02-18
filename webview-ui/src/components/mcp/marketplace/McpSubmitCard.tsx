import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import styled from "styled-components"

const McpSubmitCard = () => {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: "24px",
				padding: "32px 20px",
				marginTop: "16px",
			}}>
			{/* Logo */}
			<img
				src="https://storage.googleapis.com/cline_public_images/cline.png"
				alt="Cline bot logo"
				style={{
					width: 64,
					height: 64,
					borderRadius: 8,
				}}
			/>

			{/* Content */}
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					gap: "12px",
					textAlign: "center",
					maxWidth: "480px",
				}}>
				<h3
					style={{
						margin: 0,
						fontSize: "16px",
						fontWeight: 600,
					}}>
					Is something missing?
				</h3>
				<p style={{ fontSize: "13px", margin: 0, color: "var(--vscode-descriptionForeground)" }}>
					Submit your own MCP servers to the marketplace by{" "}
					<a href="https://github.com/cline/mcp-marketplace">submitting an issue</a> on the official MCP Marketplace
					repo on GitHub.
				</p>
			</div>
		</div>
	)
}

const StyledGitHubButton = styled.div`
	font-size: 13px;
	font-weight: 500;
	padding: 8px;
	border-radius: 2px;
	border: 1px solid var(--vscode-button-border, transparent);
	cursor: pointer;
	background: var(--vscode-button-background);
	color: var(--vscode-button-foreground);
	display: flex;
	align-items: center;
	justify-content: center;
	width: 100%;

	&:hover {
		background: var(--vscode-button-hoverBackground);
	}

	&:active {
		background: var(--vscode-button-background);
		opacity: 0.7;
	}
`

export default McpSubmitCard
