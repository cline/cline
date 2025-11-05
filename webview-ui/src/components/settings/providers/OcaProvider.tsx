import type { OcaModelInfo } from "@shared/api"
import type { OcaAuthState, OcaUserInfo } from "@shared/proto/index.cline"
import { EmptyRequest, StringRequest } from "@shared/proto/index.cline"
import { Mode } from "@shared/storage/types"
import { VSCodeButton, VSCodeCheckbox, VSCodeLink, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient, OcaAccountServiceClient } from "@/services/grpc-client"
import { VSC_BUTTON_BACKGROUND, VSC_BUTTON_FOREGROUND, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
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
			className="mt-2 mb-2 flex items-start gap-3 rounded-none px-5 py-4 pb-8 border shadow-sm min-w-[40%] max-w-[90%] w-full box-border
                 bg-input-background border-input-border">
			<div className="min-w-[22px] h-[22px] flex items-center justify-center shrink-0 mt-2">{icon}</div>
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
function useOcaModels({
	isAuthenticated,
	baseUrl,
	login,
}: {
	isAuthenticated: boolean
	baseUrl: string
	login: () => Promise<void>
}) {
	const [models, setModels] = useState<Record<string, OcaModelInfo>>({})
	const [loading, setLoading] = useState(false)
	const [hasError, setHasError] = useState(false)
	const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null)

	const reqIdRef = useRef(0)
	const unmountedRef = useRef(false)
	const debounceTimerRef = useRef<number | null>(null)

	const doRefresh = useCallback(async (url: string) => {
		const myReqId = ++reqIdRef.current
		setLoading(true)
		setHasError(false)
		try {
			const resp = await ModelsServiceClient.refreshOcaModels(StringRequest.create({ value: url || "" }))
			// Only apply if still latest and still mounted
			if (!unmountedRef.current && myReqId === reqIdRef.current) {
				if (resp.error) {
					setHasError(true)
				} else {
					setModels(resp.models || {})
					setHasError(false)
					setLastRefreshedAt(Date.now())
				}
			}
		} catch (err) {
			if (!unmountedRef.current && myReqId === reqIdRef.current) {
				console.error("Failed to refresh Oca models:", err)
				setHasError(true)
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
			setHasError(false)
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

	// User-initiated refresh with auto login + single retry on failure
	const refreshModels = useCallback(async () => {
		setLoading(true)
		setHasError(false)

		async function tryRefresh(retry = false): Promise<boolean> {
			try {
				const resp = await ModelsServiceClient.refreshOcaModels(StringRequest.create({ value: baseUrl || "" }))
				if (resp.error) {
					throw new Error(resp.error)
				}
				setModels(resp.models || {})
				setHasError(false)
				setLastRefreshedAt(Date.now())
				return true
			} catch (_err) {
				if (!retry) {
					await login() // prompt login
					return tryRefresh(true) // retry once
				} else {
					setHasError(true)
				}
				return false
			} finally {
				setLoading(false)
			}
		}

		await tryRefresh()
	}, [baseUrl, login])

	return { models, loading, hasError, refreshModels, lastRefreshedAt }
}

/**
 * The Oca provider configuration component
 */
export const OcaProvider = ({ isPopup, currentMode }: OcaProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	const { user: ocaUser, isAuthenticated, ready, login, logout } = useOcaAuth()

	const ocaBaseUrl = apiConfiguration?.ocaBaseUrl || ""
	const ocaMode = apiConfiguration?.ocaMode

	const handleToggleMode = (nextMode: "internal" | "external") => {
		handleFieldChange("ocaMode", nextMode)
	}

	const {
		models: ocaModels,
		refreshModels,
		hasError: ocaHasError,
		loading: ocaLoading,
		lastRefreshedAt,
	} = useOcaModels({
		isAuthenticated,
		baseUrl: ocaBaseUrl,
		login,
	})

	const handleRefresh = useCallback(async () => {
		await refreshModels()
	}, [refreshModels])

	// On first subscription result: if user exists, refresh models once.
	const didInitialAuthCheckRef = useRef(false)
	useEffect(() => {
		if (!ready || didInitialAuthCheckRef.current) {
			return
		}
		didInitialAuthCheckRef.current = true
		if (isAuthenticated) {
			void refreshModels()
		}
		// If user empty, do nothing (no auto login, no refresh)
	}, [ready, isAuthenticated, refreshModels])

	return (
		<div>
			{!ready ? (
				<div aria-live="polite" className="flex items-center gap-2 py-2" role="status">
					<VSCodeProgressRing />
					<span className={`text-[13px] [color:var(${VSC_DESCRIPTION_FOREGROUND})]`}>Connecting…</span>
				</div>
			) : !isAuthenticated ? (
				<div>
					<div
						aria-label="Oracle employment"
						style={{
							marginTop: 12,
							marginBottom: 4,
						}}>
						<VSCodeCheckbox
							checked={ocaMode !== "external"}
							onChange={(e: any) => {
								const checked = (e?.target as HTMLInputElement)?.checked
								handleToggleMode(checked ? "internal" : "external")
							}}>
							I’m an Oracle Employee
						</VSCodeCheckbox>
					</div>
					<VSCodeButton
						onClick={async () => {
							await login()
						}}
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
						Please ask your IT administrator to set up Oracle Code Assist as a model provider. Oracle Employees,
						please see the{" "}
						<VSCodeLink
							href="https://confluence.oraclecorp.com/confluence/display/AICODE/Oracle+Code+Assist+via+Cline"
							rel="noopener noreferrer"
							target="_blank">
							quickstart guide
						</VSCodeLink>
					</p>
				</div>
			) : (
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
						<VSCodeButton
							onClick={async () => {
								await logout()
							}}>
							Log out
						</VSCodeButton>
					</div>

					<div className="mt-0">
						<BaseUrlField
							defaultValue={undefined}
							initialValue={ocaBaseUrl}
							label="Custom Base URL (optional)"
							onChange={(value) => handleFieldChange("ocaBaseUrl", value)}
						/>
					</div>

					<OcaModelPicker
						apiConfiguration={apiConfiguration}
						currentMode={currentMode}
						isPopup={isPopup}
						lastRefreshedAt={lastRefreshedAt}
						loading={ocaLoading}
						ocaModels={ocaModels}
						onRefresh={handleRefresh}
					/>

					{isAuthenticated && ocaHasError && (
						<div
							aria-live="polite"
							className={`mt-2 text-[13px] [color:var(${VSC_DESCRIPTION_FOREGROUND})]`}
							role="status">
							<div>Failed to refresh models. Check your session or network.</div>
							<div className="mt-2 flex gap-2">
								<VSCodeButton appearance="secondary" onClick={handleRefresh}>
									Retry
								</VSCodeButton>
								<VSCodeButton
									appearance="secondary"
									onClick={async () => {
										await login()
									}}>
									Sign in again
								</VSCodeButton>
							</div>
						</div>
					)}

					<InfoCard
						icon={
							<svg
								aria-hidden
								fill="none"
								height="20"
								role="img"
								style={{ color: `var(${VSC_DESCRIPTION_FOREGROUND})` }}
								viewBox="0 0 36 35"
								width="20">
								<g clipPath="url(#clip0)">
									<path
										d="M20 13.5991C20 14.672 19.1046 15.5418 18 15.5418C16.8954 15.5418 16 14.672 16 13.5991C16 12.5261 16.8954 11.6563 18 11.6563C19.1046 11.6563 20 12.5261 20 13.5991Z"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.25"
									/>
									<path
										d="M10 15.5418C11.1046 15.5418 12 14.672 12 13.5991C12 12.5261 11.1046 11.6563 10 11.6563C8.89543 11.6563 8 12.5261 8 13.5991C8 14.672 8.89543 15.5418 10 15.5418Z"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.25"
									/>
									<path
										d="M28 13.5991C28 14.672 27.1046 15.5418 26 15.5418C24.8954 15.5418 24 14.672 24 13.5991C24 12.5261 24.8954 11.6563 26 11.6563C27.1046 11.6563 28 12.5261 28 13.5991Z"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.25"
									/>
									<path
										clipRule="evenodd"
										d="M0 0V25.2554H10V34.4L19.4142 25.2554H36V0H0ZM2 23.3127V1.94272H34V23.3127H18.5858L12 29.7099V23.3127H2Z"
										fill="none"
										fillRule="evenodd"
										stroke="currentColor"
										strokeWidth="1.25"
									/>
								</g>
								<defs>
									<clipPath id="clip0">
										<rect fill="white" height="35" width="36" />
									</clipPath>
								</defs>
							</svg>
						}>
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								alignItems: "center", // center title and button
								width: "100%",
							}}>
							<div
								style={{
									fontSize: 14,
									color: VSC_DESCRIPTION_FOREGROUND,
									fontWeight: 600,
									marginBottom: 18,
									marginTop: 2,
								}}>
								Have an idea for Oracle Code Assist?
							</div>
						</div>
						<div
							style={{
								width: "100%",
								display: "flex",
								justifyContent: "center",
								marginTop: 8,
							}}>
							<a
								href={
									ocaMode === "internal"
										? "https://apexsurveys.oracle.com/ords/surveys/t/oca-nps/survey?k=oracle-code-assist-internal-link-share&sc=SMM1BNSNUI"
										: "https://customersurveys.oracle.com/ords/surveys/t/aicode/survey?k=oracle-code-assist&sc=SUDN1ZXYQ5"
								}
								rel="noopener noreferrer"
								style={{
									fontSize: 14,
									fontWeight: 500,
									textDecoration: "none",
									background: "var(--vscode-button-background)",
									color: "var(--vscode-button-foreground)",
									padding: "8px 14px",
									minHeight: 28,
									border: "1px solid var(--vscode-button-border, transparent)",
									borderRadius: 0,
									display: "inline-flex",
									alignItems: "center",
									justifyContent: "center",
									minWidth: 0,
									boxSizing: "border-box",
									cursor: "pointer",
								}}
								target="_blank">
								Provide feedback
							</a>
						</div>
					</InfoCard>
				</div>
			)}
		</div>
	)
}

export default OcaProvider
