import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import React from "react"

export type ProviderHelpLink = {
	label: string
	href: string
}

export function buildOrgSetupUrl(provider: string): string {
	const baseUrl = "https://cline.bot/enterprise/provider-setup"
	const url = new URL(baseUrl)
	url.searchParams.set("utm_source", "cline_extension")
	url.searchParams.set("utm_medium", "product")
	url.searchParams.set("utm_campaign", "team_setup")
	url.searchParams.set("utm_content", provider)
	return url.toString()
}

type ProviderHelpCalloutProps = {
	/**
	 * Individual/self-serve setup docs links (provider-specific).
	 * Keep this short (1-3) so it stays scannable.
	 */
	docsLinks: ProviderHelpLink[]
	className?: string
	orgSetupHref?: string
	orgSetupLabel?: string
	orgSetupLinkText?: string
}

export const ProviderHelpCallout: React.FC<ProviderHelpCalloutProps> = ({
	docsLinks,
	className,
	orgSetupHref,
	orgSetupLabel = "Team setup:",
	orgSetupLinkText = "Centralized configuration →",
}) => {
	if (!docsLinks.length && !orgSetupHref) {
		return null
	}

	return (
		<div className={className}>
			{docsLinks.length > 0 && (
				<p
					style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-descriptionForeground)",
					}}>
					<span style={{ fontWeight: 500 }}>Provider setup (docs):</span>{" "}
					{docsLinks.map((link, index) => (
						<React.Fragment key={link.href}>
							<VSCodeLink
								href={link.href}
								rel="noopener noreferrer"
								style={{ display: "inline", fontSize: "inherit" }}
								target="_blank">
								{link.label}
							</VSCodeLink>
							{index < docsLinks.length - 1 ? <span style={{ opacity: 0.7 }}> · </span> : null}
						</React.Fragment>
					))}
				</p>
			)}

			{orgSetupHref && (
				<p
					style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-descriptionForeground)",
					}}>
					<span style={{ fontWeight: 500 }}>{orgSetupLabel}</span>{" "}
					<VSCodeLink
						href={orgSetupHref}
						rel="noopener noreferrer"
						style={{ display: "inline", fontSize: "inherit" }}
						target="_blank">
						{orgSetupLinkText}
					</VSCodeLink>
				</p>
			)}
		</div>
	)
}
