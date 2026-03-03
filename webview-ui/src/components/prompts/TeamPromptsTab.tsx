import type { TeamPromptsCatalog } from "@shared/prompts"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

type TeamPromptsTabProps = {
	catalog: TeamPromptsCatalog
	hasEnterpriseAccount: boolean
}

const TeamPromptsTab = ({ catalog, hasEnterpriseAccount }: TeamPromptsTabProps) => {
	if (!hasEnterpriseAccount) {
		return (
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					padding: "40px 20px",
					textAlign: "center",
					gap: "16px",
				}}>
				<h4 style={{ margin: 0 }}>Team Prompts</h4>
				<p style={{ color: "var(--vscode-descriptionForeground)", maxWidth: "400px" }}>
					Share prompts internally with your team. Upgrade to an enterprise plan to access this feature.
				</p>
				<VSCodeLink
					href="https://cline.bot/enterprise"
					style={{
						display: "inline-block",
						padding: "8px 16px",
						backgroundColor: "var(--vscode-button-background)",
						color: "var(--vscode-button-foreground)",
						textDecoration: "none",
						borderRadius: "2px",
						cursor: "pointer",
					}}>
					Learn More About Enterprise
				</VSCodeLink>
			</div>
		)
	}

	return (
		<div style={{ padding: "20px" }}>
			<h4>Team Prompts</h4>
			<p>Coming soon: Share prompts with your team</p>
			<p style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)" }}>
				Organization: {catalog.organizationId || "None"}
			</p>
		</div>
	)
}

export default TeamPromptsTab
