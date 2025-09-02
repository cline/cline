import type { OcaModelInfo } from "@shared/api"
import type { OcaAuthState, OcaUserInfo } from "@shared/proto/index.cline"
import { EmptyRequest, StringRequest } from "@shared/proto/index.cline"
import { Mode } from "@shared/storage/types"
import { VSCodeButton, VSCodeLink, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import React, { useCallback, useEffect, useRef, useState } from "react"
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
 * Auth hook:
 * - Subscribes to auth state (single source of truth).
 * - Marks when initial auth state arrives.
 * - Attempts one-shot auto-login ONLY if initial state was "unknown" (i.e., not explicitly null unauthenticated).
 * - Cleans up subscription properly.
 */
function useOcaAuth() {
	const [user, setUser] = useState<OcaUserInfo | null>(null)
	const [ready, setReady] = useState(false)

	const initialReceivedRef = useRef(false)
	const unmountedRef = useRef(false)

	const isAuthenticated = !!user?.uid

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
				const nextUser = response?.user?.uid ? (response.user as OcaUserInfo) : null
				setUser(nextUser)

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

	return { user, isAuthenticated, ready, login, logout }
}

/**
 * Models hook:
 * - Fetches OCA models only when authenticated.
 * - Debounces base URL changes to avoid unnecessary calls.
 * - Guards against race conditions with a requestId and unmount checks.
 */
function useOcaModels({ isAuthenticated, baseUrl }: { isAuthenticated: boolean; baseUrl: string }) {
	const [models, setModels] = useState<Record<string, OcaModelInfo>>({})
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const reqIdRef = useRef(0)
	const unmountedRef = useRef(false)
	const debounceTimerRef = useRef<number | null>(null)

	const doRefresh = useCallback(async (url: string) => {
		const myReqId = ++reqIdRef.current
		setLoading(true)
		setError(null)
		try {
			const resp = await ModelsServiceClient.refreshOcaModels(StringRequest.create({ value: url || "" }))
			// Only apply if still latest and still mounted
			if (!unmountedRef.current && myReqId === reqIdRef.current) {
				setModels(resp.models || {})
			}
		} catch (err) {
			if (!unmountedRef.current && myReqId === reqIdRef.current) {
				console.error("Failed to refresh Oca models:", err)
				setError("Failed to refresh models")
			}
		} finally {
			if (!unmountedRef.current && myReqId === reqIdRef.current) {
				setLoading(false)
			}
		}
	}, [])

	// Debounce changes to baseUrl or auth
	useEffect(() => {
		unmountedRef.current = false
		if (debounceTimerRef.current) {
			window.clearTimeout(debounceTimerRef.current)
			debounceTimerRef.current = null
		}

		if (!isAuthenticated) {
			// Clear models if logged out; prevent stale data
			setModels({})
			setLoading(false)
			setError(null)
			return
		}

		debounceTimerRef.current = window.setTimeout(() => {
			void doRefresh(baseUrl || "")
		}, 250)

		return () => {
			unmountedRef.current = true
			if (debounceTimerRef.current) {
				window.clearTimeout(debounceTimerRef.current)
				debounceTimerRef.current = null
			}
			// bump reqId so any in-flight result is ignored
			reqIdRef.current++
		}
	}, [isAuthenticated, baseUrl, doRefresh])

	const refresh = useCallback(() => doRefresh(baseUrl || ""), [doRefresh, baseUrl])

	return { models, loading, error, refresh }
}

/**
 * The Oca provider configuration component
 */
export const OcaProvider = ({ isPopup, currentMode }: OcaProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	const { user: ocaUser, isAuthenticated, ready, login, logout } = useOcaAuth()

	const ocaBaseUrl = apiConfiguration?.ocaBaseUrl || ""

	const { models: ocaModels, refresh: refreshOcaModels } = useOcaModels({
		isAuthenticated,
		baseUrl: ocaBaseUrl,
	})

	const handleRefresh = useCallback(async () => {
		await refreshOcaModels()
	}, [refreshOcaModels])

	// On first subscription result: if user exists, refresh models once.
	const didInitialAuthCheckRef = useRef(false)
	useEffect(() => {
		if (!ready || didInitialAuthCheckRef.current) {
			return
		}
		didInitialAuthCheckRef.current = true
		if (isAuthenticated) {
			void refreshOcaModels()
		}
		// If user empty, do nothing (no auto login, no refresh)
	}, [ready, isAuthenticated, refreshOcaModels])

	return (
		<div>
			{!ready ? (
				<div className="flex items-center gap-2 py-2">
					<VSCodeProgressRing />
					<span className={`text-[13px] [color:var(${VSC_DESCRIPTION_FOREGROUND})]`}>Connecting…</span>
				</div>
			) : !isAuthenticated ? (
				<div>
					<VSCodeButton
						onClick={async () => {
							await login()
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
						Sign In to Oracle Code Assist
					</VSCodeButton>
				</div>
			) : (
				<div>
					<div
						className={`flex flex-col gap-1 font-semibold text-[13px] my-[12px] [color:var(${VSC_DESCRIPTION_FOREGROUND})]`}>
						<span>Logged in as</span>
						{ocaUser?.email ? (
							<span className="font-semibold opacity-95">{ocaUser.email}</span>
						) : ocaUser?.uid ? (
							<span className="font-semibold opacity-95">{ocaUser.uid}</span>
						) : (
							<span className="font-semibold opacity-95">Unknown User</span>
						)}
					</div>

					<BaseUrlField
						defaultValue={undefined}
						initialValue={ocaBaseUrl}
						label="Use Custom Base URL (optional)"
						onChange={(value) => handleFieldChange("ocaBaseUrl", value)}
					/>

					<OcaModelPicker
						apiConfiguration={apiConfiguration}
						currentMode={currentMode}
						isPopup={isPopup}
						ocaModels={ocaModels}
						onRefresh={handleRefresh}
					/>

					<VSCodeButton
						onClick={async () => {
							await logout()
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

					<InfoCard
						icon={
							<svg aria-hidden fill="none" height="20" role="img" viewBox="0 0 31 31" width="20">
								<path
									d="M0.0805664 1.62516C0.0805664 0.773724 0.770794 0.0834961 1.62223 0.0834961H10.8738C12.7148 0.0834961 14.3675 0.890779 15.4972 2.17059C16.627 0.890779 18.2797 0.0834961 20.1207 0.0834961H29.3722C30.2237 0.0834961 30.9139 0.773724 30.9139 1.62516V24.7486C30.9139 25.6001 30.2237 26.2903 29.3722 26.2903H20.1222C18.4176 26.2903 17.0389 27.669 17.0389 29.3736C17.0389 30.2251 16.3487 30.9153 15.4972 30.9153C14.6458 30.9153 13.9556 30.2251 13.9556 29.3736C13.9556 27.669 12.5769 26.2903 10.8722 26.2903H1.62223C0.770794 26.2903 0.0805664 25.6001 0.0805664 24.7486V1.62516ZM13.9556 24.0311V6.24862C13.9556 4.54706 12.5753 3.16683 10.8738 3.16683H3.1639V23.207H10.8722C11.9957 23.207 13.0487 23.5069 13.9556 24.0311ZM17.0389 24.0311C17.9458 23.5069 18.9988 23.207 20.1222 23.207H27.8306V3.16683H20.1207C18.4191 3.16683 17.0389 4.54706 17.0389 6.24862V24.0311Z"
									fill="none"
									stroke={`var(${VSC_DESCRIPTION_FOREGROUND})`}
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

export default OcaProvider
