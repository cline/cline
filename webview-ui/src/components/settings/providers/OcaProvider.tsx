import { BaseUrlField } from "../common/BaseUrlField"
import OcaModelPicker from "../OcaModelPicker"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useMount } from "react-use"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import type { Mode } from "@shared/ChatSettings"

/**
 * Props for the OcaProvider component
 */
interface OcaProviderProps {
	isPopup?: boolean
	currentMode: Mode
}

function isTokenValid(accessToken?: string, expiresAt?: number, bufferSec = 300) {
	if (!accessToken || !expiresAt) return false
	return expiresAt * 1000 > Date.now() + bufferSec * 1000
}

function InfoCard({
	icon,
	children,
	style = {},
}: {
	icon: React.ReactNode
	children: React.ReactNode
	style?: React.CSSProperties
}) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "flex-start",
				gap: 12,
				background: "rgba(34, 34, 34, 0.91)", // slightly darker
				borderRadius: 16,
				padding: "15px 18px 15px 16px",
				margin: "12px 0",
				width: "100%",
				boxSizing: "border-box",
				boxShadow: "0 1px 4px rgba(0,0,0,0.10)", // subtle inner
				transition: "box-shadow 0.18s",
				...style,
			}}>
			<div
				style={{
					width: 22,
					height: 22,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					marginTop: 1,
					flexShrink: 0,
				}}>
				{icon}
			</div>
			<div style={{ flex: 1 }}>{children}</div>
		</div>
	)
}

/**
 * The Oca provider configuration component
 */
export const OcaProvider = ({ isPopup, currentMode }: OcaProviderProps) => {
	const { apiConfiguration, ocaRefreshToken, ocaLogin, ocaLogout } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	useMount(() => {
		if (apiConfiguration?.ocaAccessToken !== "logout") ocaRefreshToken()
	})

	return (
		<div>
			{!isTokenValid(apiConfiguration?.ocaAccessToken, apiConfiguration?.ocaAccessTokenExpiresAt) ? (
				<div>
					<VSCodeButton
						style={{
							fontSize: 14,
							borderRadius: 22,
							fontWeight: 500,
							background: "var(--vscode-button-background, #0078d4)",
							color: "var(--vscode-button-foreground, #fff)",
							minWidth: 0,
							margin: "12px 0",
						}}
						onClick={ocaLogin}>
						Sign In to Oracle Code Assist
					</VSCodeButton>
				</div>
			) : (
				<div>
					<div
						style={{
							fontSize: 13,
							color: "var(--vscode-descriptionForeground)",
							margin: "12px 0",
							display: "flex",
							flexDirection: "column",
							gap: 4,
							fontWeight: 600,
						}}>
						<span>Logged in as</span>
						<span style={{ fontWeight: 600, opacity: 0.95 }}>
							{apiConfiguration?.ocaAccessTokenSub ?? "Unknown User"}
						</span>
					</div>
					<BaseUrlField
						initialValue={apiConfiguration?.ocaLiteLlmBaseUrl || ""}
						defaultValue={undefined}
						onChange={(value) => handleFieldChange("ocaLiteLlmBaseUrl", value)}
						label="Use Custom Base URL (optional)"
					/>
					<OcaModelPicker isPopup={isPopup} currentMode={currentMode} />
					<VSCodeButton
						style={{
							fontSize: 14,
							borderRadius: 22,
							fontWeight: 500,
							background: "var(--vscode-button-background, #0078d4)",
							color: "var(--vscode-button-foreground, #fff)",
							minWidth: 0,
							margin: "12px 0",
						}}
						onClick={ocaLogout}>
						Log out
					</VSCodeButton>
					{/* INFO/GUIDE CARD */}
					<InfoCard
						icon={
							<svg width="20" height="20" viewBox="0 0 31 31" fill="none" aria-hidden role="img">
								<path
									d="M0.0805664 1.62516C0.0805664 0.773724 0.770794 0.0834961 1.62223 0.0834961H10.8738C12.7148 0.0834961 14.3675 0.890779 15.4972 2.17059C16.627 0.890779 18.2797 0.0834961 20.1207 0.0834961H29.3722C30.2237 0.0834961 30.9139 0.773724 30.9139 1.62516V24.7486C30.9139 25.6001 30.2237 26.2903 29.3722 26.2903H20.1222C18.4176 26.2903 17.0389 27.669 17.0389 29.3736C17.0389 30.2251 16.3487 30.9153 15.4972 30.9153C14.6458 30.9153 13.9556 30.2251 13.9556 29.3736C13.9556 27.669 12.5769 26.2903 10.8722 26.2903H1.62223C0.770794 26.2903 0.0805664 25.6001 0.0805664 24.7486V1.62516ZM13.9556 24.0311V6.24862C13.9556 4.54706 12.5753 3.16683 10.8738 3.16683H3.1639V23.207H10.8722C11.9957 23.207 13.0487 23.5069 13.9556 24.0311ZM17.0389 24.0311C17.9458 23.5069 18.9988 23.207 20.1222 23.207H27.8306V3.16683H20.1207C18.4191 3.16683 17.0389 4.54706 17.0389 6.24862V24.0311Z"
									fill="none"
									stroke="white"
									strokeWidth="1.25"
								/>
							</svg>
						}>
						<div style={{ fontSize: 14, color: "var(--vscode-descriptionForeground)", lineHeight: 1.65 }}>
							For internal Oracle Employees, <br />
							please see the{" "}
							<VSCodeLink
								href="https://confluence.oraclecorp.com/confluence/display/AICODE/Oracle+Code+Assist+via+Cline"
								style={{ color: "var(--vscode-textLink-foreground, #3794ff)", fontSize: 14, fontWeight: 500 }}>
								Quickstart Guide
							</VSCodeLink>
							.<br />
							For external customers, contact your IT admin to provision Oracle Code Assist access.
						</div>
					</InfoCard>
				</div>
			)}
		</div>
	)
}
