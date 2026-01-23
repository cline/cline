/**
 * Account info view component
 * Shows current provider, and for Cline provider: credit balance and organization name
 */

import { Box, Text } from "ink"
import React, { useCallback, useEffect, useState } from "react"
import { Controller } from "@/core/controller"
import { StateManager } from "@/core/storage/StateManager"
import { ClineAccountService } from "@/services/account/ClineAccountService"
import { AuthService, ClineAccountOrganization } from "@/services/auth/AuthService"
import { LoadingSpinner } from "./Spinner"

interface AccountInfoViewProps {
	controller: Controller
}

/**
 * Capitalize provider name for display
 */
function capitalize(str: string): string {
	return str
		.split("-")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ")
}

/**
 * Format balance as currency (balance is in microcredits, divide by 10000)
 */
function formatBalance(balance: number | null): string {
	if (balance === null || balance === undefined) {
		return "..."
	}
	return `$${(balance / 1000000).toFixed(2)}`
}

export const AccountInfoView: React.FC<AccountInfoViewProps> = React.memo(({ controller }) => {
	const [provider, setProvider] = useState<string | null>(null)
	const [balance, setBalance] = useState<number | null>(null)
	const [organization, setOrganization] = useState<ClineAccountOrganization | null>(null)
	const [email, setEmail] = useState<string | null>(null)
	const [isLoading, setIsLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	const fetchAccountInfo = useCallback(async () => {
		try {
			setIsLoading(true)
			setError(null)

			// Get current provider from state
			const stateManager = StateManager.get()
			const mode = stateManager.getGlobalSettingsKey("mode") as string
			const providerKey = mode === "act" ? "actModeApiProvider" : "planModeApiProvider"
			const currentProvider = stateManager.getGlobalSettingsKey(providerKey) as string
			setProvider(currentProvider || "cline")

			// If using Cline provider, fetch additional info
			if (currentProvider === "cline") {
				const authService = AuthService.getInstance(controller)

				// Wait for auth to be restored - poll until we have auth info or timeout
				let authInfo = authService.getInfo()
				let attempts = 0
				const maxAttempts = 20 // 2 seconds max
				while (!authInfo?.user?.uid && attempts < maxAttempts) {
					await new Promise((resolve) => setTimeout(resolve, 100))
					authInfo = authService.getInfo()
					attempts++
				}

				// Get user info
				if (authInfo?.user?.email) {
					setEmail(authInfo.user.email)
				} else {
					// User not logged in to Cline
					setEmail(null)
					setIsLoading(false)
					return
				}

				// Get organization info
				const organizations = authService.getUserOrganizations()
				if (organizations) {
					const activeOrg = organizations.find((org) => org.active)
					if (activeOrg) {
						setOrganization(activeOrg)
					}
				}

				// Fetch credit balance
				try {
					const accountService = ClineAccountService.getInstance()
					const activeOrgId = authService.getActiveOrganizationId()

					if (activeOrgId) {
						// Fetch organization balance
						const orgBalance = await accountService.fetchOrganizationCreditsRPC(activeOrgId)
						if (orgBalance?.balance !== undefined) {
							setBalance(orgBalance.balance)
						}
					} else {
						// Fetch personal balance
						const balanceData = await accountService.fetchBalanceRPC()
						if (balanceData?.balance !== undefined) {
							setBalance(balanceData.balance)
						}
					}
				} catch {
					// Balance fetch failed, but we can still show other info
					// Don't log to console as it pollutes CLI output
				}
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load account info")
		} finally {
			setIsLoading(false)
		}
	}, [controller])

	useEffect(() => {
		fetchAccountInfo()
	}, [fetchAccountInfo])

	if (isLoading) {
		return (
			<Box>
				<LoadingSpinner />
				<Text color="gray"> Loading account info...</Text>
			</Box>
		)
	}

	if (error) {
		return (
			<Box>
				<Text color="red">Error: {error}</Text>
			</Box>
		)
	}

	// If not using Cline provider, just show the provider name
	if (provider !== "cline") {
		return (
			<Box>
				<Text color="gray">Provider: </Text>
				<Text color="cyan">{capitalize(provider || "Not configured")}</Text>
			</Box>
		)
	}

	// Cline provider but not logged in
	if (!email) {
		return (
			<Box>
				<Text color="gray">Provider: </Text>
				<Text color="cyan">Cline</Text>
				<Text color="gray"> • </Text>
				<Text color="yellow">Not logged in (run 'cline auth' to sign in)</Text>
			</Box>
		)
	}

	// Cline provider - show full account info
	return (
		<Box flexDirection="column">
			<Box>
				<Text color="gray">Provider: </Text>
				<Text color="cyan">Cline</Text>
				{email && (
					<Box>
						<Text color="gray"> • </Text>
						<Text color="white">{email}</Text>
					</Box>
				)}
			</Box>
			<Box>
				{organization ? (
					<Box>
						<Text color="gray">Organization: </Text>
						<Text color="magenta">{organization.name}</Text>
					</Box>
				) : (
					<Box>
						<Text color="gray">Account: </Text>
						<Text color="white">Personal</Text>
					</Box>
				)}
				<Text color="gray"> • Credits: </Text>
				<Text color="green">{formatBalance(balance)}</Text>
			</Box>
		</Box>
	)
})
