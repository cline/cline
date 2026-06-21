import type { ProviderConfigField } from "@shared/proto/cline/models"
import type { OcaAuthState, OcaUserInfo } from "@shared/proto/index.cline"
import { EmptyRequest } from "@shared/proto/index.cline"
import { Mode } from "@shared/storage/types"
import { VSCodeButton, VSCodeCheckbox, VSCodeLink, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { type ProviderId, useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { OcaAccountServiceClient } from "@/services/grpc-client"
import { VSC_BUTTON_BACKGROUND, VSC_BUTTON_FOREGROUND, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import { BaseUrlField } from "../common/BaseUrlField"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { GenericProviderSettings } from "./GenericProviderSettings"
import OcaModelPicker from "./OcaModelPicker"

interface OcaProviderProps {
	isPopup?: boolean
	currentMode: Mode
	configFields?: ProviderConfigField[]
	configValuesJson?: Record<string, string>
	lockedFieldPaths?: readonly string[]
}

function useOcaAuth() {
	const [user, setUser] = useState<OcaUserInfo | null>(null)
	const [ready, setReady] = useState(false)
	const initialReceivedRef = useRef(false)
	const unmountedRef = useRef(false)

	const login = useCallback(async () => {
		try {
			await OcaAccountServiceClient.ocaAccountLoginClicked(EmptyRequest.create())
		} catch (error) {
			console.error("OCA login failed:", error)
		}
	}, [])

	const logout = useCallback(async () => {
		try {
			await OcaAccountServiceClient.ocaAccountLogoutClicked(EmptyRequest.create())
		} catch (error) {
			console.error("OCA logout failed:", error)
		}
	}, [])

	useEffect(() => {
		unmountedRef.current = false
		const cancel = OcaAccountServiceClient.ocaSubscribeToAuthStatusUpdate(EmptyRequest.create(), {
			onResponse: (response: OcaAuthState) => {
				if (unmountedRef.current) {
					return
				}
				setUser(response?.user?.uid ? (response.user as OcaUserInfo) : null)
				if (!initialReceivedRef.current) {
					initialReceivedRef.current = true
					setReady(true)
				}
			},
			onError: (err: Error) => {
				if (!unmountedRef.current) {
					console.error("OCA auth callback subscription error:", err)
					if (!initialReceivedRef.current) {
						initialReceivedRef.current = true
						setReady(true)
					}
				}
			},
			onComplete: () => {
				// no-op
			},
		})

		return () => {
			unmountedRef.current = true
			cancel()
		}
	}, [])

	return { user, isAuthenticated: Boolean(user?.uid), ready, login, logout }
}

export const OcaProvider = ({ isPopup, currentMode, configFields, configValuesJson, lockedFieldPaths }: OcaProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()
	const { write } = useProviderConfig("oca" as ProviderId)
	const { user: ocaUser, isAuthenticated, ready, login, logout } = useOcaAuth()

	const ocaBaseUrl = apiConfiguration?.ocaBaseUrl || ""
	const ocaMode = apiConfiguration?.ocaMode

	const handleToggleMode = (nextMode: "internal" | "external") => {
		handleFieldChange("ocaMode", nextMode)
		void write({ settingsJson: JSON.stringify({ oca: { mode: nextMode } }) }).catch((err) =>
			console.error("Failed to update Oracle Code Assist mode:", err),
		)
	}

	const handleBaseUrlChange = (value: string) => {
		handleFieldChange("ocaBaseUrl", value)
		void write({ baseUrl: value }).catch((err) => console.error("Failed to update Oracle Code Assist base URL:", err))
	}

	const sdkConfigFields =
		configFields && configFields.length > 0 ? (
			<GenericProviderSettings
				allowsCustomIds={false}
				configFields={configFields}
				configValuesJson={configValuesJson}
				currentMode={currentMode}
				isPopup={isPopup}
				lockedFieldPaths={lockedFieldPaths}
				providerId={"oca" as ProviderId}
				providerName="Oracle Code Assist"
				showModelOptions={false}
			/>
		) : null

	if (!ready) {
		return (
			<div aria-live="polite" className="flex items-center gap-2 py-2" role="status">
				<VSCodeProgressRing />
				<span className={`text-[13px] [color:var(${VSC_DESCRIPTION_FOREGROUND})]`}>Connecting...</span>
			</div>
		)
	}

	if (!isAuthenticated) {
		return (
			<div>
				<div aria-label="Oracle employment" style={{ marginTop: 12, marginBottom: 4 }}>
					<VSCodeCheckbox
						checked={ocaMode !== "external"}
						onChange={(event: any) => {
							const checked = (event?.target as HTMLInputElement)?.checked
							handleToggleMode(checked ? "internal" : "external")
						}}>
						I’m an Oracle Employee
					</VSCodeCheckbox>
				</div>
				{sdkConfigFields}
				<VSCodeButton
					onClick={() => void login()}
					style={{
						fontSize: 14,
						fontWeight: 500,
						background: `var(${VSC_BUTTON_BACKGROUND}, #0078d4)`,
						color: `var(${VSC_BUTTON_FOREGROUND}, #fff)`,
						minWidth: 0,
						margin: "12px 0",
					}}>
					Sign in with Oracle Code Assist
				</VSCodeButton>
				<p className="text-xs mt-0 text-(--vscode-descriptionForeground)">
					Please ask your IT administrator to set up Oracle Code Assist as a model provider. Oracle Employees, please
					see the{" "}
					<VSCodeLink
						href="https://confluence.oraclecorp.com/confluence/display/AICODE/Oracle+Code+Assist+via+Cline"
						rel="noopener noreferrer"
						target="_blank">
						quickstart guide
					</VSCodeLink>
				</p>
			</div>
		)
	}

	return (
		<div>
			<div className={`flex items-center justify-between mt-0 mb-0 [color:var(${VSC_DESCRIPTION_FOREGROUND})]`}>
				<div className="flex flex-col gap-0 font-semibold text-[13px]">
					<span>Signed in</span>
					{ocaUser?.email ? (
						<span className="font-semibold opacity-95 mt-2">{ocaUser.email}</span>
					) : ocaUser?.uid ? (
						<span className="font-semibold opacity-95 mt-2">{ocaUser.uid}</span>
					) : (
						<span className="font-semibold opacity-95 mt-2">Unknown User</span>
					)}
				</div>
				<VSCodeButton onClick={() => void logout()}>Log out</VSCodeButton>
			</div>

			<div className="mt-0">
				<BaseUrlField
					defaultValue={undefined}
					initialValue={ocaBaseUrl}
					label="Custom Base URL (optional)"
					onChange={handleBaseUrlChange}
				/>
			</div>

			{sdkConfigFields}
			<OcaModelPicker currentMode={currentMode} isPopup={isPopup} />
		</div>
	)
}
