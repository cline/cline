import { useClineAuth } from "@/context/ClineAuthContext"
import { AccountServiceClient } from "@/services/grpc-client"
import { UsageTransaction as ClineAccountUsageTransaction, PaymentTransaction } from "@shared/ClineAccount"
import { UsageTransaction as ProtoUsageTransaction, UserOrganization } from "@shared/proto/account"
import { EmptyRequest } from "@shared/proto/common"
import {
	VSCodeButton,
	VSCodeDivider,
	VSCodeDropdown,
	VSCodeLink,
	VSCodeOption,
	VSCodeTag,
} from "@vscode/webview-ui-toolkit/react"
import { memo, useCallback, useEffect, useMemo, useState } from "react"
import ClineLogoWhite from "../../assets/ClineLogoWhite"
import CreditsHistoryTable from "./CreditsHistoryTable"
import debounce from "debounce"
import deepEqual from "fast-deep-equal"
import VSCodeButtonLink from "../common/VSCodeButtonLink"
import { StyledCreditDisplay } from "./StyledCreditDisplay"

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

	// Source of truth: Dedicated state for dropdown value that persists through failures
	// and represents that user's current selection.
	const [dropdownValue, setDropdownValue] = useState<string>("personal")

	const [isLoading, setIsLoading] = useState(true)

	const [balance, setBalance] = useState<number | null>(null)
	const [usageData, setUsageData] = useState<ClineAccountUsageTransaction[]>([])
	const [paymentsData, setPaymentsData] = useState<PaymentTransaction[]>([])
	const [lastFetchTime, setLastFetchTime] = useState<number>(Date.now())

	const clineUris = useMemo(() => {
		const base = new URL(clineUser?.appBaseUrl || CLINE_APP_URL)
		const dashboard = new URL("dashboard", base)
		const credits = new URL(dropdownValue === "personal" ? "/account" : "/organization", dashboard)
		credits.searchParams.set("tab", "credits")
		credits.searchParams.set("redirect", "true")

		return {
			dashboard,
			credits,
		}
	}, [clineUser?.appBaseUrl, dropdownValue])

	const [userOrganizations, setUserOrganizations] = useState<UserOrganization[]>([])
	const activeOrganization = useMemo(() => {
		return userOrganizations.find((org) => org.organizationId === dropdownValue)
	}, [userOrganizations, dropdownValue])

	const getUserOrganizations = useCallback(async () => {
		try {
			if (clineUser?.uid) {
				const response = await AccountServiceClient.getUserOrganizations(EmptyRequest.create())
				if (response?.organizations && !deepEqual(userOrganizations, response.organizations)) {
					setUserOrganizations(response.organizations)
				}
			}
		} catch (error) {
			console.error("Failed to fetch user organizations:", error)
		}
	}, [userOrganizations, clineUser?.uid, dropdownValue])

	const fetchCreditBalance = useCallback(
		async (orgId?: string) => {
			try {
				setIsLoading(true)
				const targetOrgId = orgId ?? dropdownValue
				const isPersonal = targetOrgId === "personal"

				// Use targetOrgId consistently for all requests
				const response = isPersonal
					? await AccountServiceClient.getUserCredits(EmptyRequest.create())
					: await AccountServiceClient.getOrganizationCredits({ organizationId: targetOrgId })

				// Update balance if changed
				const newBalance = response.balance?.currentBalance
				if (newBalance !== undefined && newBalance !== balance) {
					setBalance(newBalance)
				}
				if (response.usageTransactions && !deepEqual(usageData, response.usageTransactions)) {
					const clineUsage = convertProtoUsageTransactions(response.usageTransactions) || []
					setUsageData(clineUsage)
				}

				// Organizations don't have payment transactions
				if (targetOrgId !== "personal") {
					setPaymentsData([])
					setIsLoading(false)
					return
				}

				// Check if response is UserCreditsData type
				if (typeof response !== "object" || !("paymentTransactions" in response)) {
					return
				}
				const newPaymentsData = response.paymentTransactions
				// Check if paymentTransactions is part of the response
				if (newPaymentsData?.length && !deepEqual(paymentsData, newPaymentsData)) {
					setPaymentsData(newPaymentsData)
				}
			} catch (error) {
				console.error("Failed to fetch credit balance:", error)
			} finally {
				setLastFetchTime(Date.now())
				setIsLoading(false)
			}
		},
		[dropdownValue, balance],
	)

	// Create a debounced version of fetchCreditBalance
	const debouncedFetchCreditBalance = useMemo(
		() => debounce(() => fetchCreditBalance(), 500, { immediate: true }),
		[fetchCreditBalance],
	)

	const handleManualRefresh = useCallback(() => {
		if (!isLoading) {
			debouncedFetchCreditBalance()
		}
	}, [debouncedFetchCreditBalance, isLoading])

	const handleOrganizationChange = useCallback(
		async (event: any) => {
			const newValue = (event.target as VSCodeDropdownChangeEvent["target"]).value || "personal"
			const organizationId = newValue === "personal" ? undefined : newValue

			if (newValue === dropdownValue) {
				return // No change, do nothing
			}

			try {
				console.info("Changing selection to:", newValue)

				// Send the change to the server
				AccountServiceClient.setUserOrganization({ organizationId })

				// Update dropdownValue immediately - this persists through failures
				setDropdownValue(newValue)
				setIsLoading(true)
				setBalance(null)
				setUsageData([])
				setPaymentsData([])

				await fetchCreditBalance(organizationId)
			} catch (error) {
				console.error("Failed to update organization:", error)
				// Don't reset selectedOrgId on error - keep the user's selection
				// The next refresh will use the correct selectedOrgId
			} finally {
				setIsLoading(false)
			}
		},
		[fetchCreditBalance, getUserOrganizations, dropdownValue],
	)

	// Fetching initial data
	useEffect(() => {
		const loadData = async () => {
			if (clineUser?.uid) {
				// Start with personal account as we do not have the user's organizations yet
				AccountServiceClient.setUserOrganization({ organizationId: undefined })
				await getUserOrganizations()
				await fetchCreditBalance()
			}
		}
		loadData()
	}, [clineUser?.uid])

	// Periodic refresh
	useEffect(() => {
		const refreshData = async () => {
			try {
				if (clineUser?.uid) {
					await getUserOrganizations()
					await fetchCreditBalance()
				}
			} catch (error) {
				console.error("Error during periodic refresh:", error)
			}
		}

		const intervalId = setInterval(refreshData, 60000)
		return () => clearInterval(intervalId)
	}, [clineUser?.uid])

	return (
		<div className="h-full flex flex-col">
			{clineUser ? (
				<div className="flex flex-col pr-3 h-full">
					<div className="flex flex-col w-full">
						<div className="flex items-center mb-6 flex-wrap gap-y-4">
							{/* {user.photoUrl ? (
								<img src={user.photoUrl} alt="Profile" className="size-16 rounded-full mr-4" />
							) : ( */}
							<div className="size-16 rounded-full bg-[var(--vscode-button-background)] flex items-center justify-center text-2xl text-[var(--vscode-button-foreground)] mr-4">
								{clineUser.displayName?.[0] || clineUser.email?.[0] || "?"}
							</div>
							{/* )} */}

							<div className="flex flex-col">
								{clineUser.displayName && (
									<h2 className="text-[var(--vscode-foreground)] m-0 text-lg font-medium">
										{clineUser.displayName}
									</h2>
								)}

								{clineUser.email && (
									<div className="text-sm text-[var(--vscode-descriptionForeground)]">{clineUser.email}</div>
								)}

								<div className="flex gap-2 items-center mt-1">
									<VSCodeDropdown
										currentValue={dropdownValue}
										onChange={handleOrganizationChange}
										disabled={isLoading}
										className="w-full">
										<VSCodeOption value="personal" key="personal">
											Personal
										</VSCodeOption>
										{userOrganizations?.map((org: UserOrganization) => (
											<VSCodeOption key={org.organizationId} value={org.organizationId}>
												{org.name}
											</VSCodeOption>
										))}
									</VSCodeDropdown>
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
							isLoading={isLoading}
							usageData={usageData}
							paymentsData={paymentsData}
							showPayments={dropdownValue === "personal"}
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
