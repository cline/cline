import type { UsageTransaction as ClineAccountUsageTransaction, PaymentTransaction } from "@shared/ClineAccount"
import { isClineInternalTester } from "@shared/internal/account"
import type { UserOrganization } from "@shared/proto/cline/account"
import { EmptyRequest } from "@shared/proto/cline/common"
import { VSCodeButton, VSCodeDivider, VSCodeDropdown, VSCodeOption, VSCodeTag } from "@vscode/webview-ui-toolkit/react"
import deepEqual from "fast-deep-equal"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useInterval } from "react-use"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { type ClineUser, handleSignOut } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { AccountServiceClient } from "@/services/grpc-client"
import { getClineEnvironmentClassname } from "@/utils/environmentColors"
import VSCodeButtonLink from "../common/VSCodeButtonLink"
import { updateSetting } from "../settings/utils/settingsHandlers"
import { AccountWelcomeView } from "./AccountWelcomeView"
import { CreditBalance } from "./CreditBalance"
import CreditsHistoryTable from "./CreditsHistoryTable"
import { convertProtoUsageTransactions, getClineUris, getMainRole } from "./helpers"

type AccountViewProps = {
	clineUser: ClineUser | null
	organizations: UserOrganization[] | null
	activeOrganization: UserOrganization | null
	onDone: () => void
}

type ClineAccountViewProps = {
	clineUser: ClineUser
	userOrganizations: UserOrganization[] | null
	activeOrganization: UserOrganization | null
	clineEnv: "Production" | "Staging" | "Local"
}

type CachedData = {
	balance: number | null
	usageData: ClineAccountUsageTransaction[]
	paymentsData: PaymentTransaction[]
	lastFetchTime: number
}

const ClineEnvOptions = ["Production", "Staging", "Local"] as const

const AccountView = ({ onDone, clineUser, organizations, activeOrganization }: AccountViewProps) => {
	const { environment } = useExtensionState()
	const titleColor = getClineEnvironmentClassname(environment)

	return (
		<div className="fixed inset-0 flex flex-col overflow-hidden pt-[10px] pl-[20px]">
			<div className="flex justify-between items-center mb-[17px] pr-[17px]">
				<h3 className={cn("text-(--vscode-foreground) m-0", titleColor)}>
					Account {environment !== "production" ? ` - ${environment} environment` : ""}
				</h3>
				<VSCodeButton onClick={onDone}>Done</VSCodeButton>
			</div>
			<div className="grow overflow-hidden pr-[8px] flex flex-col">
				<div className="h-full mb-1.5">
					{clineUser?.uid ? (
						<ClineAccountView
							activeOrganization={activeOrganization}
							clineEnv={environment === "local" ? "Local" : environment === "staging" ? "Staging" : "Production"}
							clineUser={clineUser}
							key={clineUser.uid}
							userOrganizations={organizations}
						/>
					) : (
						<AccountWelcomeView />
					)}
				</div>
			</div>
		</div>
	)
}

export const ClineAccountView = ({ clineUser, userOrganizations, activeOrganization, clineEnv }: ClineAccountViewProps) => {
	const { email, displayName, appBaseUrl, uid } = clineUser
	const { remoteConfigSettings } = useExtensionState()

	// Determine if dropdown should be locked by remote config
	const isLockedByRemoteConfig = Object.keys(remoteConfigSettings || {}).length > 0
	console.log("isLockedByRemoteConfig", isLockedByRemoteConfig)

	// Source of truth: Dedicated state for dropdown value that persists through failures
	// and represents that user's current selection.
	const [dropdownValue, setDropdownValue] = useState<string>(activeOrganization?.organizationId || uid)
	const [isLoading, setIsLoading] = useState(false)

	// Cache data per organization/user ID to avoid showing empty state when switching
	const dataCache = useRef<Map<string, CachedData>>(new Map())

	// Current displayed data
	const [balance, setBalance] = useState<number | null>(null)
	const [usageData, setUsageData] = useState<ClineAccountUsageTransaction[]>([])
	const [paymentsData, setPaymentsData] = useState<PaymentTransaction[]>([])
	const [lastFetchTime, setLastFetchTime] = useState<number>(Date.now())

	// Load cached data for current dropdown value
	const loadCachedData = useCallback((id: string) => {
		const cached = dataCache.current.get(id)
		if (cached) {
			setBalance(cached.balance)
			setUsageData(cached.usageData)
			setPaymentsData(cached.paymentsData)
			setLastFetchTime(cached.lastFetchTime)
			return true
		}
		return false
	}, [])

	// Simple cache function without dependencies
	const cacheCurrentData = useCallback(
		(id: string) => {
			dataCache.current.set(id, {
				balance,
				usageData,
				paymentsData,
				lastFetchTime,
			})
		},
		[balance, usageData, paymentsData, lastFetchTime],
	)
	// Track the active organization ID to detect changes
	const [lastActiveOrgId, setLastActiveOrgId] = useState<string | undefined>(activeOrganization?.organizationId)
	// Use ref for debounce timeout to avoid re-renders
	const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null)
	// Track if manual fetch is in progress to avoid duplicate fetches
	const manualFetchInProgressRef = useRef<boolean>(false)
	// Track if initial mount fetch has completed to avoid duplicate fetches
	const initialFetchCompleteRef = useRef<boolean>(false)

	const isClineTester = useMemo(() => (email ? isClineInternalTester(email) : false), [email])

	const fetchUserCredit = useCallback(async () => {
		try {
			const response = await AccountServiceClient.getUserCredits(EmptyRequest.create())
			const newBalance = response?.balance?.currentBalance
			// Always update balance, even if it's 0 or null - don't skip undefined
			setBalance(newBalance ?? null)
			const newUsage = convertProtoUsageTransactions(response.usageTransactions)
			setUsageData((prev) => (deepEqual(newUsage, prev) ? prev : newUsage))
			const newPaymentsData = response.paymentTransactions
			setPaymentsData((prev) => (deepEqual(newPaymentsData, prev) ? prev : newPaymentsData))
		} catch (error) {
			console.error("Failed to fetch user credit:", error)
		}
	}, [])

	const fetchCreditBalance = useCallback(
		async (id: string, skipCache = false) => {
			try {
				if (isLoading) {
					return // Prevent multiple concurrent fetches
				}

				// Load cached data immediately if available (unless skipping cache)
				if (!skipCache && loadCachedData(id)) {
					// If we have cached data, show it first, then fetch in background
				}

				setIsLoading(true)
				if (id === uid) {
					await fetchUserCredit()
				} else {
					const response = await AccountServiceClient.getOrganizationCredits({
						organizationId: id,
					})
					// Update balance - handle all values including 0 and null
					const newBalance = response.balance?.currentBalance
					setBalance(newBalance ?? null)

					const newUsage = convertProtoUsageTransactions(response.usageTransactions)
					setUsageData((prev) => (deepEqual(newUsage, prev) ? prev : newUsage))
				}

				// Cache the updated data
				cacheCurrentData(id)
			} catch (error) {
				console.error("Failed to fetch credit balance:", error)
			} finally {
				setLastFetchTime(Date.now())
				setIsLoading(false)
			}
		},
		[isLoading, uid, fetchUserCredit, loadCachedData],
	)

	const handleOrganizationChange = useCallback(
		async (event: any) => {
			const target = event.target as HTMLSelectElement
			if (!target) {
				return
			}

			const newValue = target.value
			if (newValue !== dropdownValue) {
				// Clear any pending debounced fetch since we're doing a manual one
				if (debounceTimeoutRef.current) {
					clearTimeout(debounceTimeoutRef.current)
					debounceTimeoutRef.current = null
				}

				// Cache current data before switching
				cacheCurrentData(dropdownValue)
				setDropdownValue(newValue)

				// Load cached data for new selection immediately, or clear if no cache
				// Only clear if we don't have cached data to avoid unnecessary flashing
				if (!loadCachedData(newValue)) {
					// No cached data - clear current state to avoid showing wrong data
					setBalance(null)
					setUsageData([])
					setPaymentsData([])
				}

				// Set flag to indicate manual fetch in progress
				manualFetchInProgressRef.current = true

				// Fetch the new data
				await fetchCreditBalance(newValue)

				// Update the last active org ID to prevent the effect from triggering
				setLastActiveOrgId(newValue === uid ? undefined : newValue)

				// Send the change to the server
				const organizationId = newValue === uid ? undefined : newValue
				await AccountServiceClient.setUserOrganization({ organizationId })

				// Clear the manual fetch flag after everything is done
				manualFetchInProgressRef.current = false
			}
		},
		[uid, dropdownValue, loadCachedData, fetchCreditBalance, cacheCurrentData],
	)

	// Fetch balance every 60 seconds
	useInterval(() => {
		fetchCreditBalance(dropdownValue)
	}, 60000)

	const clineUrl = appBaseUrl || "https://app.cline.bot"

	// Fetch balance on mount
	useEffect(() => {
		async function initialFetch() {
			await fetchCreditBalance(dropdownValue)
			initialFetchCompleteRef.current = true
		}
		initialFetch()
	}, [])

	useEffect(() => {
		// Handle organization changes with 500ms debounce
		const currentActiveOrgId = activeOrganization?.organizationId
		const hasActiveOrgChanged = currentActiveOrgId !== lastActiveOrgId

		// Only handle external organization changes (not dropdown changes)
		// Dropdown changes are handled by handleOrganizationChange
		const isExternalOrgChange = hasActiveOrgChanged && !manualFetchInProgressRef.current

		if (isExternalOrgChange) {
			// Clear any existing timeout
			if (debounceTimeoutRef.current) {
				clearTimeout(debounceTimeoutRef.current)
			}

			// Update dropdown to match the new active organization
			const newDropdownValue = currentActiveOrgId || uid
			if (newDropdownValue !== dropdownValue) {
				// Cache current data before switching
				cacheCurrentData(dropdownValue)
				setDropdownValue(newDropdownValue)

				// Load cached data for new selection immediately, or clear if no cache
				// Only clear data if initial fetch has completed to avoid clearing on mount
				if (!loadCachedData(newDropdownValue) && initialFetchCompleteRef.current) {
					// No cached data - clear to avoid showing wrong data
					setBalance(null)
					setUsageData([])
					setPaymentsData([])
				}
			}

			// Only set timeout if initial fetch is complete
			if (initialFetchCompleteRef.current) {
				// Set new timeout to fetch after 500ms
				debounceTimeoutRef.current = setTimeout(() => {
					fetchCreditBalance(newDropdownValue)
					setLastActiveOrgId(currentActiveOrgId)
				}, 500)
			} else {
				// Just update the active org ID
				setLastActiveOrgId(currentActiveOrgId)
			}
		}

		// Cleanup timeout on unmount
		return () => {
			if (debounceTimeoutRef.current) {
				clearTimeout(debounceTimeoutRef.current)
			}
		}
	}, [
		activeOrganization?.organizationId,
		lastActiveOrgId,
		uid,
		dropdownValue,
		loadCachedData,
		fetchCreditBalance,
		cacheCurrentData,
	])

	return (
		<div className="h-full flex flex-col">
			<div className="flex flex-col pr-3 h-full">
				<div className="flex flex-col w-full">
					<div className="flex items-center mb-6 flex-wrap gap-y-4">
						{/* {user.photoUrl ? (
								<img src={user.photoUrl} alt="Profile" className="size-16 rounded-full mr-4" />
							) : ( */}
						<div className="size-16 rounded-full bg-button-background flex items-center justify-center text-2xl text-button-foreground mr-4">
							{displayName?.[0] || email?.[0] || "?"}
						</div>
						{/* )} */}

						<div className="flex flex-col">
							{displayName && <h2 className="text-foreground m-0 text-lg font-medium">{displayName}</h2>}

							{email && <div className="text-sm text-description">{email}</div>}

							<div className="flex gap-2 items-center mt-1">
								<Tooltip>
									<TooltipTrigger>
										<VSCodeDropdown
											className="w-full"
											currentValue={dropdownValue}
											disabled={isLoading || isLockedByRemoteConfig}
											onChange={handleOrganizationChange}>
											<VSCodeOption key="personal" value={uid}>
												Personal
											</VSCodeOption>
											{userOrganizations?.map((org: UserOrganization) => (
												<VSCodeOption key={org.organizationId} value={org.organizationId}>
													{org.name}
												</VSCodeOption>
											))}
										</VSCodeDropdown>
									</TooltipTrigger>
									<TooltipContent hidden={!isLockedByRemoteConfig}>
										This cannot be changed while your organization has remote configuration enabled.
									</TooltipContent>
								</Tooltip>
								{activeOrganization && (
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
						<VSCodeButtonLink appearance="primary" className="w-full" href={getClineUris(clineUrl, "dashboard").href}>
							Dashboard
						</VSCodeButtonLink>
					</div>
					<VSCodeButton appearance="secondary" className="w-full min-[225px]:w-1/2" onClick={() => handleSignOut()}>
						Log out
					</VSCodeButton>
				</div>

				<VSCodeDivider className="w-full my-6" />

				<CreditBalance
					balance={balance}
					creditUrl={getClineUris(clineUrl, "credits", dropdownValue === uid ? "account" : "organization")}
					fetchCreditBalance={() => fetchCreditBalance(dropdownValue)}
					isLoading={isLoading}
					lastFetchTime={lastFetchTime}
				/>

				<VSCodeDivider className="mt-6 mb-3 w-full" />

				<div className="grow flex flex-col min-h-0 pb-[0px]">
					<CreditsHistoryTable
						isLoading={isLoading}
						paymentsData={paymentsData}
						showPayments={dropdownValue === uid}
						usageData={usageData}
					/>
				</div>

				{isClineTester && (
					<div className="w-full gap-1 items-end">
						<VSCodeDivider className="w-full my-3" />
						<div className="text-sm font-semibold">Cline Environment</div>
						<VSCodeDropdown
							className="w-full mt-1"
							currentValue={clineEnv}
							onChange={async (e) => {
								const target = e.target as HTMLSelectElement
								if (target?.value) {
									const value = target.value as "Local" | "Staging" | "Production"
									updateSetting("clineEnv", value.toLowerCase())
								}
							}}>
							{ClineEnvOptions.map((env) => (
								<VSCodeOption key={env} value={env}>
									{env}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
					</div>
				)}
			</div>
		</div>
	)
}

export default memo(AccountView)
