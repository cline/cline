import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"

export interface ActionMetadata {
	id: keyof AutoApprovalSettings["actions"] | "enableNotifications"
	label: string
	shortName: string
	icon: string
	subAction?: ActionMetadata
	sub?: boolean
	parentActionId?: string
}
