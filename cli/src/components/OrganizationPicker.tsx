/**
 * Organization picker component for switching between personal account and organizations
 */

import React, { useMemo } from "react"
import type { ClineAccountOrganization } from "@/services/auth/AuthService"
import { SelectList, SelectListItem } from "./SelectList"

interface OrganizationPickerProps {
	organizations: ClineAccountOrganization[]
	onSelect: (orgId: string | null) => void // null = personal account
	isActive?: boolean
}

/**
 * Get the primary role for display (prioritize owner > admin > member)
 */
function getPrimaryRole(roles: string[]): string {
	if (roles.includes("owner")) return "Owner"
	if (roles.includes("admin")) return "Admin"
	if (roles.includes("member")) return "Member"
	return roles[0] || ""
}

export const OrganizationPicker: React.FC<OrganizationPickerProps> = ({ organizations, onSelect, isActive = true }) => {
	const items: SelectListItem[] = useMemo(() => {
		const result: SelectListItem[] = [
			{
				id: "personal",
				label: "Personal",
			},
		]

		for (const org of organizations) {
			const role = getPrimaryRole(org.roles)
			result.push({
				id: org.organizationId,
				label: org.name,
				suffix: role ? `(${role})` : undefined,
			})
		}

		return result
	}, [organizations])

	return <SelectList isActive={isActive} items={items} onSelect={(item) => onSelect(item.id === "personal" ? null : item.id)} />
}
