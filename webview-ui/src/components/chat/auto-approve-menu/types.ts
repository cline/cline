import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"

export interface ActionMetadata {
	id: keyof AutoApprovalSettings["actions"] | "enableNotifications" | "yoloModeToggled"
	label: string
	shortName: string
	description: string
	icon: string
	subAction?: ActionMetadata
	sub?: boolean
	parentActionId?: string
}
