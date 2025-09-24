import { useState, useEffect } from "react"
import { Building2, User, Plus } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectSeparator } from "@/components/ui/select"
import { type CloudUserInfo, type CloudOrganizationMembership } from "@roo-code/types"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"
import { type ExtensionMessage } from "@roo/ExtensionMessage"

type OrganizationSwitcherProps = {
	userInfo: CloudUserInfo
	organizations: CloudOrganizationMembership[]
	onOrganizationChange?: (organizationId: string | null) => void
	cloudApiUrl?: string
}

export const OrganizationSwitcher = ({
	userInfo,
	organizations,
	onOrganizationChange,
	cloudApiUrl,
}: OrganizationSwitcherProps) => {
	const { t } = useAppTranslation()
	const [selectedOrgId, setSelectedOrgId] = useState<string | null>(userInfo.organizationId || null)
	const [isLoading, setIsLoading] = useState(false)

	// Update selected org when userInfo changes
	useEffect(() => {
		setSelectedOrgId(userInfo.organizationId || null)
	}, [userInfo.organizationId])

	// Listen for organization switch results
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data as ExtensionMessage
			if (message.type === "organizationSwitchResult") {
				// Reset loading state when we receive the result
				setIsLoading(false)

				if (message.success) {
					// Update selected org based on the result
					setSelectedOrgId(message.organizationId ?? null)
				} else {
					// Revert to the previous organization on error
					setSelectedOrgId(userInfo.organizationId || null)
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [userInfo.organizationId])

	const handleOrganizationChange = async (value: string) => {
		// Handle "Create Team Account" option
		if (value === "create-team") {
			if (cloudApiUrl) {
				const billingUrl = `${cloudApiUrl}/billing`
				vscode.postMessage({ type: "openExternal", url: billingUrl })
			}
			return
		}

		const newOrgId = value === "personal" ? null : value

		// Don't do anything if selecting the same organization
		if (newOrgId === selectedOrgId) {
			return
		}

		setIsLoading(true)

		// Send message to switch organization
		vscode.postMessage({
			type: "switchOrganization",
			organizationId: newOrgId,
		})

		// Update local state optimistically
		setSelectedOrgId(newOrgId)

		// Call the callback if provided
		if (onOrganizationChange) {
			onOrganizationChange(newOrgId)
		}
	}

	// Always show the switcher when user is authenticated

	const currentValue = selectedOrgId || "personal"

	return (
		<div className="w-full">
			<Select value={currentValue} onValueChange={handleOrganizationChange} disabled={isLoading}>
				<SelectTrigger className="w-full">
					<SelectValue>
						<div className="flex items-center gap-2">
							{selectedOrgId ? (
								<>
									{organizations.find((org) => org.organization.id === selectedOrgId)?.organization
										.image_url ? (
										<img
											src={
												organizations.find((org) => org.organization.id === selectedOrgId)
													?.organization.image_url
											}
											alt=""
											className="w-4.5 h-4.5 rounded-full object-cover overflow-clip"
										/>
									) : (
										<Building2 className="w-4.5 h-4.5" />
									)}
									<span className="truncate">
										{
											organizations.find((org) => org.organization.id === selectedOrgId)
												?.organization.name
										}
									</span>
								</>
							) : (
								<>
									<div className="p-0.5 bg-vscode-button-background rounded-full flex items-center justify-center text-vscode-button-foreground text-xs">
										<User className="w-4 h-4 text-vscode-button-foreground" />
									</div>
									<span>{t("cloud:personalAccount")}</span>
								</>
							)}
						</div>
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="personal">
						<div className="flex items-center gap-2">
							<User className="w-4.5 h-4.5" />
							<span>{t("cloud:personalAccount")}</span>
						</div>
					</SelectItem>
					{organizations.length > 0 && <SelectSeparator />}
					{organizations.map((org) => (
						<SelectItem key={org.organization.id} value={org.organization.id}>
							<div className="flex items-center gap-2">
								{org.organization.image_url ? (
									<img
										src={org.organization.image_url}
										alt=""
										className="w-4.5 h-4.5 rounded-full object-cover overflow-clip"
									/>
								) : (
									<Building2 className="w-4.5 h-4.5" />
								)}
								<span className="truncate">{org.organization.name}</span>
							</div>
						</SelectItem>
					))}

					{/* Only show Create Team Account if user has no organizations */}
					{organizations.length === 0 && (
						<>
							<SelectSeparator />
							<SelectItem value="create-team">
								<div className="flex items-center gap-2">
									<Plus className="w-4.5 h-4.5" />
									<span>{t("cloud:createTeamAccount")}</span>
								</div>
							</SelectItem>
						</>
					)}
				</SelectContent>
			</Select>
		</div>
	)
}
