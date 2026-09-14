import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"

export interface ActionMetadata {
	id: keyof AutoApprovalSettings["actions"] | "enableNotifications"
	/** i18n key for the action's label, resolved with t() at the render site. */
	label: string
	/** i18n key for the action's short name, resolved with t() at the render site. */
	shortName: string
	icon: string
	subAction?: ActionMetadata
	sub?: boolean
	parentActionId?: string
}
