import { useClineAuth } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"
import { formatCreditsBalance } from "@/utils/format"
import { UsageTransaction as ClineAccountUsageTransaction, PaymentTransaction } from "@shared/ClineAccount"
import { UsageTransaction as ProtoUsageTransaction, UserOrganization, UserOrganizationUpdateRequest } from "@shared/proto/account"
import { EmptyRequest } from "@shared/proto/common"
import {
	VSCodeButton,
	VSCodeDivider,
	VSCodeDropdown,
	VSCodeLink,
	VSCodeOption,
	VSCodeTag,
} from "@vscode/webview-ui-toolkit/react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import ClineLogoWhite from "../../assets/ClineLogoWhite"
import CreditsHistoryTable from "./CreditsHistoryTable"
import { GetOrganizationCreditsRequest } from "@shared/proto/account"
import debounce from "debounce"
import deepEqual from "fast-deep-equal"
import VSCodeButtonLink from "../common/VSCodeButtonLink"

// Custom hook for animated credit display with styled decimals
const useAnimatedCredits = (targetValue: number, duration: number = 660) => {
	const [currentValue, setCurrentValue] = useState(0)
	const animationRef = useRef<number>()
	const startTimeRef = useRef<number>()

	useEffect(() => {
		const animate = (timestamp: number) => {
			if (!startTimeRef.current) {
				startTimeRef.current = timestamp
			}

			const elapsed = timestamp - startTimeRef.current
			const progress = Math.min(elapsed / duration, 1)

			// Easing function (ease-out)
			const easedProgress = 1 - (1 - progress) ** 3
			const newValue = easedProgress * targetValue

			setCurrentValue(newValue)

			if (progress < 1) {
				animationRef.current = requestAnimationFrame(animate)
			}
		}

		// Reset and start animation
		startTimeRef.current = undefined
		animationRef.current = requestAnimationFrame(animate)

		return () => {
			if (animationRef.current) {
				cancelAnimationFrame(animationRef.current)
			}
		}
	}, [targetValue, duration])

	return currentValue
}

// Custom component to handle styled credit display
const StyledCreditDisplay = ({ balance }: { balance: number }) => {
	const animatedValue = useAnimatedCredits(formatCreditsBalance(balance))
	const formatted = animatedValue.toFixed(4)
	const parts = formatted.split(".")
	const wholePart = parts[0]
	const decimalPart = parts[1] || "0000"
	const firstTwoDecimals = decimalPart.slice(0, 2)
	const lastTwoDecimals = decimalPart.slice(2)

	return (
		<span className="font-azeret-mono font-light tabular-nums">
			{wholePart}.{firstTwoDecimals}
			<span className="text-[var(--vscode-descriptionForeground)]">{lastTwoDecimals}</span>
		</span>
	)
}

type VSCodeDropdownChangeEvent = Event & {
	target: {
		value: string
	}
}

type AccountViewProps = {
	onDone: () => void
}

const AccountView = ({ onDone }: AccountViewProps) => {
	return (
		<div className="fixed inset-0 flex flex-col overflow-hidden pt-[10px] pl-[20px]">
			<div className="flex justify-between items-center mb-[17px] pr-[17px]">
				<h3 className="text-[var(--vscode-foreground)] m-0">Account</h3>
				<VSCodeButton onClick={onDone}>Done</VSCodeButton>
			</div>
			<div className="flex-grow overflow-hidden pr-[8px] flex flex-col">
				<div className="h-full mb-[5px]">
					<ClineAccountView />
				</div>
			</div>
		</div>
	)
}

const getMainRole = (roles?: string[]) => {
	if (!roles) return undefined

	if (roles.includes("owner")) return "Owner"
	if (roles.includes("admin")) return "Admin"

	return "Member"
}

const CLINE_APP_URL = "https://app.cline.bot"

export const ClineAccountView = () => {
	const { clineUser, handleSignIn, handleSignOut } = useClineAuth()
	const { userInfo, apiConfiguration } = useExtensionState()

	const user = apiConfiguration?.clineAccountId ? clineUser || userInfo : undefined

	const [balance, setBalance] = useState<number | null>(null)
	const [userOrganizations, setUserOrganizations] = useState<UserOrganization[]>([])
	const [activeOrganization, setActiveOrganization] = useState<UserOrganization | null>(null)
	const [isLoading, setIsLoading] = useState(true)
	const [isSwitchingProfile, setIsSwitchingProfile] = useState(false)
	const [usageData, setUsageData] = useState<ClineAccountUsageTransaction[]>([])
	const [paymentsData, setPaymentsData] = useState<PaymentTransaction[]>([])
	const [lastFetchTime, setLastFetchTime] = useState<number>(Date.now())

	const clineUris = useMemo(() => {
		const base = new URL(clineUser?.appBaseUrl || CLINE_APP_URL)
		const dashboard = new URL("dashboard", base)
		const credits = new URL(activeOrganization ? "/organization" : "/account", dashboard)
		credits.searchParams.set("tab", "credits")
		credits.searchParams.set("redirect", "true")

		return {
			dashboard,
			credits,
		}
	}, [clineUser?.appBaseUrl, activeOrganization])

	// Add a ref to track the intended organization during transitions
	const pendingOrganizationRef = useRef<string | null>(null)

	const getUserOrganizations = useCallback(async () => {
		try {
			const response = await AccountServiceClient.getUserOrganizations(EmptyRequest.create())
			if (response.organizations && !deepEqual(userOrganizations, response.organizations)) {
				setUserOrganizations(response.organizations)

				// Only update activeOrganization if we're not in the middle of a switch
				// or if the server response matches our pending change
				const serverActiveOrg = response.organizations.find((org: UserOrganization) => org.active)
				const serverActiveOrgId = serverActiveOrg?.organizationId || ""

				if (!isSwitchingProfile || pendingOrganizationRef.current === serverActiveOrgId) {
					if (serverActiveOrgId !== (activeOrganization?.organizationId || "")) {
						setActiveOrganization(serverActiveOrg || null)
					}
					// Clear pending ref if the server state matches
					if (pendingOrganizationRef.current === serverActiveOrgId) {
						pendingOrganizationRef.current = null
					}
				}
			}
		} catch (error) {
			console.error("Failed to fetch user organizations:", error)
		}
	}, [userOrganizations, isSwitchingProfile, activeOrganization?.organizationId])

	const fetchCreditBalance = useCallback(async () => {
		try {
			setIsLoading(true)

			// Use the pending organization if we're switching, otherwise use current active org
			const targetOrgId =
				pendingOrganizationRef.current !== null ? pendingOrganizationRef.current : activeOrganization?.organizationId

			const response = targetOrgId
				? await AccountServiceClient.getOrganizationCredits(
						GetOrganizationCreditsRequest.fromPartial({
							organizationId: targetOrgId,
						}),
					)
				: await AccountServiceClient.getUserCredits(EmptyRequest.create())

			// Update balance if changed
			const newBalance = response.balance?.currentBalance
			if (newBalance !== balance) {
				setBalance(newBalance ?? null)
			}

			const clineUsage = convertProtoUsageTransactions(response.usageTransactions)
			setUsageData(clineUsage || [])

			if (activeOrganization?.organizationId) {
				setPaymentsData([]) // Organizations don't have payment transactions
			} else {
				// Check if response is UserCreditsData type
				if (typeof response !== "object" || !("paymentTransactions" in response)) {
					return
				}
				const paymentsData = response.paymentTransactions || []
				// Check if paymentTransactions is part of the response
				if (response.paymentTransactions?.length !== paymentsData?.length) {
					setPaymentsData(paymentsData)
				}
			}
		} finally {
			setLastFetchTime(Date.now())
			setIsLoading(false)
		}
	}, [activeOrganization?.organizationId])

	const handleManualRefresh = useCallback(
		debounce(() => !isLoading && fetchCreditBalance(), 500, { immediate: true }),
		[fetchCreditBalance, isLoading],
	)

	const handleOrganizationChange = useCallback(
		async (event: any) => {
			const newOrgId = (event.target as VSCodeDropdownChangeEvent["target"]).value
			const currentOrgId = activeOrganization?.organizationId || ""

			if (currentOrgId !== newOrgId) {
				setIsSwitchingProfile(true)
				setBalance(null)

				// Set the pending organization immediately to prevent race conditions
				pendingOrganizationRef.current = newOrgId

				try {
					// Update local state immediately for UI responsiveness
					if (newOrgId === "") {
						setActiveOrganization(null)
					} else {
						const org = userOrganizations.find((org: UserOrganization) => org.organizationId === newOrgId)
						if (org) {
							setActiveOrganization(org)
						}
					}

					// Send the change to the server
					await AccountServiceClient.setUserOrganization(
						UserOrganizationUpdateRequest.create({ organizationId: newOrgId }),
					)

					// Fetch fresh data for the new organization
					await fetchCreditBalance()

					// Refresh organizations to get the updated active state from server
					await getUserOrganizations()
				} catch (error) {
					console.error("Failed to update organization:", error)
					// Reset pending ref on error
					pendingOrganizationRef.current = null
				} finally {
					setIsSwitchingProfile(false)
				}
			}
		},
		[activeOrganization?.organizationId, fetchCreditBalance, getUserOrganizations, userOrganizations],
	)

	// Handle organization changes and initial load
	useEffect(() => {
		// Reset state when user is not logged in
		if (!clineUser?.uid) {
			setIsLoading(true)
			setBalance(null)
			setUserOrganizations([])
			setActiveOrganization(null)
			setIsSwitchingProfile(false)
			return
		}
		const loadData = async () => {
			await getUserOrganizations()
			await fetchCreditBalance()
		}
		loadData()
	}, [activeOrganization?.organizationId, clineUser?.uid])

	// Periodic refresh
	useEffect(() => {
		const refreshData = async () => {
			try {
				if (clineUser?.uid) {
					await Promise.all([getUserOrganizations(), fetchCreditBalance()])
				}
			} catch (error) {
				console.error("Error during periodic refresh:", error)
			}
		}

		const intervalId = setInterval(refreshData, 30000)
		return () => clearInterval(intervalId)
	}, [clineUser?.uid, getUserOrganizations, fetchCreditBalance])

	// Determine the current dropdown value, considering pending changes
	const dropdownValue =
		pendingOrganizationRef.current !== null ? pendingOrganizationRef.current : activeOrganization?.organizationId || ""

	return (
		<div className="h-full flex flex-col">
			{user ? (
				<div className="flex flex-col pr-3 h-full">
					<div className="flex flex-col w-full">
						<div className="flex items-center mb-6 flex-wrap gap-y-4">
							{/* {user.photoUrl ? (
								<img src={user.photoUrl} alt="Profile" className="size-16 rounded-full mr-4" />
							) : ( */}
							<div className="size-16 rounded-full bg-[var(--vscode-button-background)] flex items-center justify-center text-2xl text-[var(--vscode-button-foreground)] mr-4">
								{user.displayName?.[0] || user.email?.[0] || "?"}
							</div>
							{/* )} */}

							<div className="flex flex-col">
								{user.displayName && (
									<h2 className="text-[var(--vscode-foreground)] m-0 text-lg font-medium">
										{user.displayName}
									</h2>
								)}

								{user.email && (
									<div className="text-sm text-[var(--vscode-descriptionForeground)]">{user.email}</div>
								)}

								<div className="flex gap-2 items-center mt-1">
									{userOrganizations && (
										<VSCodeDropdown
											currentValue={dropdownValue}
											onChange={handleOrganizationChange}
											disabled={isSwitchingProfile}
											className="w-full">
											<VSCodeOption value="">Personal</VSCodeOption>
											{userOrganizations.map((org: UserOrganization) => (
												<VSCodeOption key={org.organizationId} value={org.organizationId}>
													{org.name}
												</VSCodeOption>
											))}
										</VSCodeDropdown>
									)}
									{activeOrganization?.roles && (
										<VSCodeTag className="text-xs p-2" title="Role">
											{getMainRole(activeOrganization.roles)}
										</VSCodeTag>
									)}
								</div>
							</div>
						</div>
					</div>

					<div className="w-full flex gap-2 flex-col min-[225px]:flex-row">
						<div className="w-full min-[225px]:w-1/2">
							<VSCodeButtonLink href={clineUris.dashboard.href} appearance="primary" className="w-full">
								Dashboard
							</VSCodeButtonLink>
						</div>
						<VSCodeButton appearance="secondary" onClick={() => handleSignOut()} className="w-full min-[225px]:w-1/2">
							Log out
						</VSCodeButton>
					</div>

					<VSCodeDivider className="w-full my-6" />

					<div
						className="w-full flex flex-col items-center"
						title={`Last updated: ${new Date(lastFetchTime).toLocaleTimeString()}`}>
						<div className="text-sm text-[var(--vscode-descriptionForeground)] mb-3 font-azeret-mono font-light">
							CURRENT BALANCE
						</div>

						<div className="text-4xl font-bold text-[var(--vscode-foreground)] mb-6 flex items-center gap-2">
							{balance === null ? <span>----</span> : <StyledCreditDisplay balance={balance} />}
							<VSCodeButton
								appearance="icon"
								className={`mt-1 ${isLoading ? "animate-spin" : ""}`}
								onClick={handleManualRefresh}
								disabled={isLoading}>
								<span className="codicon codicon-refresh"></span>
							</VSCodeButton>
						</div>

						<div className="w-full">
							<VSCodeButtonLink href={clineUris.credits.href} className="w-full">
								Add Credits
							</VSCodeButtonLink>
						</div>
					</div>

					<VSCodeDivider className="mt-6 mb-3 w-full" />

					<div className="flex-grow flex flex-col min-h-0 pb-[0px]">
						<CreditsHistoryTable
							isLoading={isSwitchingProfile}
							usageData={usageData}
							paymentsData={paymentsData}
							showPayments={!activeOrganization?.active}
						/>
					</div>
				</div>
			) : (
				<div className="flex flex-col items-center pr-3">
					<ClineLogoWhite className="size-16 mb-4" />

					<p>
						Sign up for an account to get access to the latest models, billing dashboard to view usage and credits,
						and more upcoming features.
					</p>

					<VSCodeButton onClick={() => handleSignIn()} className="w-full mb-4">
						Sign up with Cline
					</VSCodeButton>

					<p className="text-[var(--vscode-descriptionForeground)] text-xs text-center m-0">
						By continuing, you agree to the <VSCodeLink href="https://cline.bot/tos">Terms of Service</VSCodeLink> and{" "}
						<VSCodeLink href="https://cline.bot/privacy">Privacy Policy.</VSCodeLink>
					</p>
				</div>
			)}
		</div>
	)
}

/**
 * Converts a protobuf UsageTransaction to a ClineAccount UsageTransaction
 * by adding the missing id and metadata fields
 */
function convertProtoUsageTransaction(protoTransaction: ProtoUsageTransaction): ClineAccountUsageTransaction {
	return {
		...protoTransaction,
		id: protoTransaction.generationId, // Use generationId as the id
		metadata: {
			additionalProp1: "",
			additionalProp2: "",
			additionalProp3: "",
		},
	}
}

/**
 * Converts an array of protobuf UsageTransactions to ClineAccount UsageTransactions
 */
function convertProtoUsageTransactions(protoTransactions: ProtoUsageTransaction[]): ClineAccountUsageTransaction[] {
	return protoTransactions.map(convertProtoUsageTransaction)
}

export default memo(AccountView)
