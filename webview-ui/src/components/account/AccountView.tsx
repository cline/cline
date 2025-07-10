import { VSCodeButton, VSCodeDivider, VSCodeLink, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useState } from "react"
import { BadgeCent } from "lucide-react"
import { useClineAuth } from "@/context/ClineAuthContext"
import VSCodeButtonLink from "../common/VSCodeButtonLink"
import ClineLogoWhite from "../../assets/ClineLogoWhite"
import CountUp from "react-countup"
import CreditsHistoryTable from "./CreditsHistoryTable"
import { UsageTransaction, PaymentTransaction } from "@shared/ClineAccount"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"
import { EmptyRequest } from "@shared/proto/common"
import { GetOrganizationCreditsRequest, UserOrganization, UserOrganizationUpdateRequest } from "@shared/proto/account"

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

export const ClineAccountView = () => {
	const { clineUser, handleSignIn, handleSignOut } = useClineAuth()
	const { userInfo, apiConfiguration } = useExtensionState()

	let user = apiConfiguration?.clineAccountId ? clineUser || userInfo : undefined

	const [balance, setBalance] = useState(0)
	const [userOrganizations, setUserOrganizations] = useState<UserOrganization[]>([])
	const [activeOrganization, setActiveOrganization] = useState<UserOrganization | null>(null)
	const [isLoading, setIsLoading] = useState(true)
	const [usageData, setUsageData] = useState<UsageTransaction[]>([])
	const [paymentsData, setPaymentsData] = useState<PaymentTransaction[]>([])

	const dashboardAddCreditsURL = activeOrganization
		? "https://app.cline.bot/dashboard/organization?tab=credits&redirect=true"
		: "https://app.cline.bot/dashboard/account?tab=credits&redirect=true"

	async function getUserCredits() {
		setIsLoading(true)
		try {
			const response = await AccountServiceClient.getUserCredits(EmptyRequest.create())
			setBalance(response.balance?.currentBalance || 0)
			setUsageData(response.usageTransactions)
			setPaymentsData(response.paymentTransactions)
		} catch (error) {
			console.error("Failed to fetch user credits data:", error)
			setBalance(0)
			setUsageData([])
			setPaymentsData([])
		} finally {
			setIsLoading(false)
		}
	}

	async function getOrganizationCredits() {
		setIsLoading(true)
		if (!activeOrganization) {
			await getUserCredits()
			return
		}
		try {
			const response = await AccountServiceClient.getOrganizationCredits(
				GetOrganizationCreditsRequest.create({
					organizationId: activeOrganization.organizationId,
				}),
			)
			setBalance(response.balance?.currentBalance || 0)
			setUsageData(response.usageTransactions)
			setPaymentsData(response.paymentTransactions)
		} catch (error) {
			console.error("Failed to fetch organization credits data:", error)
			setBalance(0)
			setUsageData([])
			setPaymentsData([])
		} finally {
			setIsLoading(false)
		}
	}

	async function getUserOrganizations() {
		setIsLoading(true)
		try {
			const response = await AccountServiceClient.getUserOrganizations(EmptyRequest.create())
			setUserOrganizations(response.organizations || [])
			setActiveOrganization(response.organizations.find((org: UserOrganization) => org.active) || null)
		} catch (error) {
			console.error("Failed to fetch user organizations:", error)
			setUserOrganizations([])
			setActiveOrganization(null)
		} finally {
			setIsLoading(false)
		}
	}

	// Fetch all account data when component mounts using gRPC
	useEffect(() => {
		if (!user) return

		const fetchUserData = async () => {
			try {
				await getUserCredits()
				await getUserOrganizations()
			} catch (error) {
				console.error("Failed to fetch user data:", error)
			}
		}

		fetchUserData()
	}, [user])

	useEffect(() => {
		if (!activeOrganization) return

		const fetchOrgCredits = async () => {
			try {
				await getOrganizationCredits()
			} catch (error) {
				console.error("Failed to fetch organization credits:", error)
			}
		}

		fetchOrgCredits()
	}, [activeOrganization])

	const handleLogin = () => {
		handleSignIn()
	}

	const handleLogout = () => {
		handleSignOut()
	}

	const handleOrganizationChange = async (event: any) => {
		const newOrgId = (event.target as VSCodeDropdownChangeEvent["target"]).value

		if (!activeOrganization || activeOrganization.organizationId !== newOrgId) {
			try {
				await AccountServiceClient.setUserOrganization(UserOrganizationUpdateRequest.create({ organizationId: newOrgId }))
				await getUserOrganizations()
			} catch (error) {
				console.error("Failed to update organization:", error)
			}
		}
	}

	return (
		<div className="h-full flex flex-col">
			{user ? (
				<div className="flex flex-col pr-3 h-full">
					<div className="flex flex-col w-full">
						<div className="flex items-center mb-6 flex-wrap gap-y-4">
							{user.photoUrl ? (
								<img src={user.photoUrl} alt="Profile" className="size-16 rounded-full mr-4" />
							) : (
								<div className="size-16 rounded-full bg-[var(--vscode-button-background)] flex items-center justify-center text-2xl text-[var(--vscode-button-foreground)] mr-4">
									{user.displayName?.[0] || user.email?.[0] || "?"}
								</div>
							)}

							<div className="flex flex-col">
								{user.displayName && (
									<h2 className="text-[var(--vscode-foreground)] m-0 text-lg font-medium">
										{user.displayName}
									</h2>
								)}

								{user.email && (
									<div className="text-sm text-[var(--vscode-descriptionForeground)]">{user.email}</div>
								)}

								{userOrganizations && (
									<VSCodeDropdown
										key={`dropdown-${activeOrganization?.organizationId || "Personal"}`}
										currentValue={activeOrganization?.organizationId || ""}
										onChange={handleOrganizationChange}
										style={{ width: "100%", marginTop: "4px" }}>
										<VSCodeOption value="">Personal</VSCodeOption>
										{userOrganizations.map((org: UserOrganization) => (
											<VSCodeOption key={org.organizationId} value={org.organizationId}>
												{org.name}
											</VSCodeOption>
										))}
									</VSCodeDropdown>
								)}
							</div>
						</div>
					</div>

					<div className="w-full flex gap-2 flex-col min-[225px]:flex-row">
						<div className="w-full min-[225px]:w-1/2">
							<VSCodeButtonLink href="https://app.cline.bot/dashboard" appearance="primary" className="w-full">
								Dashboard
							</VSCodeButtonLink>
						</div>
						<VSCodeButton appearance="secondary" onClick={handleLogout} className="w-full min-[225px]:w-1/2">
							Log out
						</VSCodeButton>
					</div>

					<VSCodeDivider className="w-full my-6" />

					<div className="w-full flex flex-col items-center">
						<div className="text-sm text-[var(--vscode-descriptionForeground)] mb-3">CURRENT BALANCE</div>

						<div className="text-4xl font-bold text-[var(--vscode-foreground)] mb-6 flex items-center gap-2">
							{isLoading ? (
								<div className="text-[var(--vscode-descriptionForeground)]">Loading...</div>
							) : (
								<>
									<BadgeCent className="size-6 text-[var(--vscode-foreground)]" />
									{/* TODO: Do this in a more correct way.  We have to divide by 10000
									 * because the balance is stored in microcredits in the backend.
									 */}
									<CountUp end={balance / 10000} duration={0.66} decimals={4} />
									<VSCodeButton appearance="icon" className="mt-1" onClick={getUserCredits}>
										<span className="codicon codicon-refresh"></span>
									</VSCodeButton>
								</>
							)}
						</div>

						<div className="w-full">
							<VSCodeButtonLink href={dashboardAddCreditsURL} className="w-full">
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
							showPayments={!activeOrganization}
						/>
					</div>
				</div>
			) : (
				<div className="flex flex-col items-center pr-3">
					<ClineLogoWhite className="size-16 mb-4" />

					<p style={{}}>
						Sign up for an account to get access to the latest models, billing dashboard to view usage and credits,
						and more upcoming features.
					</p>

					<VSCodeButton onClick={handleLogin} className="w-full mb-4">
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

export default memo(AccountView)
