import { CloudUserInfo } from "@roo-code/types"

export interface CloudServiceCallbacks {
	userChanged?: (userInfo: CloudUserInfo | undefined) => void
	settingsChanged?: () => void
}
