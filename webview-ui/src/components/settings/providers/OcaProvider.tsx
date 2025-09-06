import type { OcaModelInfo } from "@shared/api"
import type { OcaAuthState, OcaUserInfo } from "@shared/proto/index.cline"
import { EmptyRequest, StringRequest } from "@shared/proto/index.cline"
import { Mode } from "@shared/storage/types"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient, OcaAccountServiceClient } from "@/services/grpc-client"
import {
	VSC_BUTTON_BACKGROUND,
	VSC_BUTTON_FOREGROUND,
	VSC_DESCRIPTION_FOREGROUND,
	VSC_INPUT_BACKGROUND,
	VSC_INPUT_BORDER,
} from "@/utils/vscStyles"
import { BaseUrlField } from "../common/BaseUrlField"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import OcaModelPicker from "./OcaModelPicker"

/**
 * Props for the OcaProvider component
 */
interface OcaProviderProps {
	isPopup?: boolean
	currentMode: Mode
}

function InfoCard({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
	return (
		<div
			className={`flex items-start gap-3 rounded-xl px-5 py-4 border shadow-sm min-w-[40%] max-w-[90%] w-full box-border 
                 bg-[var(${VSC_INPUT_BACKGROUND})] border-[var(${VSC_INPUT_BORDER})]`}>
			<div className="min-w-[22px] h-[22px] flex items-center justify-center shrink-0 mt-px">{icon}</div>
			<div className="flex-1">{children}</div>
		</div>
	)
}

/**
 * The Oca provider configuration component
 */
export const OcaProvider = ({ isPopup, currentMode }: OcaProviderProps) => {
	const [ocaUser, setOcaUser] = useState<OcaUserInfo | null>(null)
	const { apiConfiguration } = useExtensionState()
	const [ocaModels, setOcaModels] = useState<Record<string, OcaModelInfo>>({})
	const { handleFieldChange } = useApiConfigurationHandlers()
	const loginAttemptedRef = useRef(false)
	const [authInitialized, setAuthInitialized] = useState(false)
	// Track the first auth update from subscription to decide auto-login behavior
	const hasReceivedFirstAuthUpdateRef = useRef(false)
	const initialAuthWasNullRef = useRef<boolean | null>(null)

	const ocaLogin = async () => {
		try {
			await OcaAccountServiceClient.ocaAccountLoginClicked(EmptyRequest.create())
		} catch (error) {
			console.error("OCA login failed:", error)
		}
	}

	const ocaLogout = async () => {
		try {
			await OcaAccountServiceClient.ocaAccountLogoutClicked(EmptyRequest.create())
		} catch (error) {
			console.error("OCA logout failed:", error)
		}
	}

	const isAuthenticated = !!ocaUser?.uid

	const refreshOcaModels = async (url: string) => {
		try {
			const response = await ModelsServiceClient.refreshOcaModels(StringRequest.create({ value: url || "" }))
			setOcaModels(response.models || {})
		} catch (error) {
			console.error("Failed to refresh Oca models:", error)
		}
	}

	useEffect(() => {
		// After the first auth update arrives, attempt login once if not already authenticated,
		// but DO NOT auto-login if the first subscription update indicated no user (null/none).
		if (!authInitialized) return
		if (hasReceivedFirstAuthUpdateRef.current && initialAuthWasNullRef.current) {
			return
		}
		if (!loginAttemptedRef.current && !isAuthenticated) {
			loginAttemptedRef.current = true
			void ocaLogin()
		}
	}, [authInitialized, isAuthenticated])

	useEffect(() => {
		// Only refresh models after we've received the first auth update and are authenticated
		if (!authInitialized || !isAuthenticated) return
		void refreshOcaModels(apiConfiguration?.ocaBaseUrl || "")
	}, [authInitialized, isAuthenticated, apiConfiguration?.ocaBaseUrl])

	// Subscribe to OCA auth status updates (verified source of truth)
	useEffect(() => {
		const cancelSubscription = OcaAccountServiceClient.ocaSubscribeToAuthStatusUpdate(EmptyRequest.create(), {
			onResponse: (response: OcaAuthState) => {
				if (response?.user?.uid) {
					setOcaUser(response.user as OcaUserInfo)
				} else {
					setOcaUser(null)
				}
				// Mark that we've received the initial auth state from the subscription (only once)
				if (!hasReceivedFirstAuthUpdateRef.current) {
					initialAuthWasNullRef.current = !response?.user?.uid
					setAuthInitialized(true)
					hasReceivedFirstAuthUpdateRef.current = true
				}
			},
			onError: (error: Error) => {
				console.error("OCA auth callback subscription error:", error)
			},
			onComplete: () => {
				console.log("OCA auth callback subscription completed")
			},
		})
		return () => {
			cancelSubscription()
		}
	}, [])

	// Refresh models on auth or base URL changes

	return (
		<div>
			{!isAuthenticated ? (
				<div>
					<VSCodeButton
						onClick={async () => {
							await ocaLogin()
						}}
						style={{
							fontSize: 14,
							borderRadius: 22,
							fontWeight: 500,
							background: "var(--vscode-button-background, #0078d4)",
							color: "var(--vscode-button-foreground, #fff)",
							minWidth: 0,
							margin: "12px 0",
						}}>
						Sign In to Oracle Code Assist
					</VSCodeButton>
				</div>
			) : (
				<div>
					<div
						className={`flex flex-col gap-1 font-semibold text-[13px] my-[12px] [color:var(${VSC_DESCRIPTION_FOREGROUND})]`}>
						<span>Logged in as</span>
						<span className="font-semibold opacity-95">{ocaUser?.uid || "Unknown User"}</span>
					</div>
					<BaseUrlField
						defaultValue={undefined}
						initialValue={apiConfiguration?.ocaBaseUrl || ""}
						label="Use Custom Base URL (optional)"
						onChange={(value) => handleFieldChange("ocaBaseUrl", value)}
					/>
					<OcaModelPicker
						currentMode={currentMode}
						isPopup={isPopup}
						ocaModels={ocaModels}
						onRefresh={async () => {
							await refreshOcaModels(apiConfiguration?.ocaBaseUrl || "")
						}}
					/>
					<VSCodeButton
						onClick={async () => {
							await ocaLogout()
						}}
						style={{
							fontSize: 14,
							borderRadius: 22,
							fontWeight: 500,
							background: `var(${VSC_BUTTON_BACKGROUND}, #0078d4)`,
							color: `var(${VSC_BUTTON_FOREGROUND}, #fff)`,
							minWidth: 0,
							margin: "12px 0",
						}}>
						Log out
					</VSCodeButton>
					{/* INFO/GUIDE CARD */}
					<InfoCard
						icon={
							<svg aria-hidden fill="none" height="20" role="img" viewBox="0 0 31 31" width="20">
								<path
									d="M0.0805664 1.62516C0.0805664 0.773724 0.770794 0.0834961 1.62223 0.0834961H10.8738C12.7148 0.0834961 14.3675 0.890779 15.4972 2.17059C16.627 0.890779 18.2797 0.0834961 20.1207 0.0834961H29.3722C30.2237 0.0834961 30.9139 0.773724 30.9139 1.62516V24.7486C30.9139 25.6001 30.2237 26.2903 29.3722 26.2903H20.1222C18.4176 26.2903 17.0389 27.669 17.0389 29.3736C17.0389 30.2251 16.3487 30.9153 15.4972 30.9153C14.6458 30.9153 13.9556 30.2251 13.9556 29.3736C13.9556 27.669 12.5769 26.2903 10.8722 26.2903H1.62223C0.770794 26.2903 0.0805664 25.6001 0.0805664 24.7486V1.62516ZM13.9556 24.0311V6.24862C13.9556 4.54706 12.5753 3.16683 10.8738 3.16683H3.1639V23.207H10.8722C11.9957 23.207 13.0487 23.5069 13.9556 24.0311ZM17.0389 24.0311C17.9458 23.5069 18.9988 23.207 20.1222 23.207H27.8306V3.16683H20.1207C18.4191 3.16683 17.0389 4.54706 17.0389 6.24862V24.0311Z"
									fill="none"
									stroke="white"
									strokeWidth="1.25"
								/>
							</svg>
						}>
						<div className={`text-[14px] leading-[1.65] [color:var(${VSC_DESCRIPTION_FOREGROUND})]`}>
							For internal Oracle Employees, <br />
							please see the{" "}
							<VSCodeLink
								href="https://confluence.oraclecorp.com/confluence/display/AICODE/Oracle+Code+Assist+via+Cline"
								style={{ color: "var(--vscode-textLink-foreground, #3794ff)", fontSize: 14, fontWeight: 500 }}>
								Quickstart Guide
							</VSCodeLink>
							.<br />
							For external customers, contact your IT admin to provision Oracle Code Assist as a provider.
						</div>
					</InfoCard>
				</div>
			)}
		</div>
	)
}
