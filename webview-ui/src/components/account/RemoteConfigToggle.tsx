import { UpdateSettingsRequest, UserOrganization } from "@shared/proto/index.cline"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useRef } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"

const isAdminOrOwner = (activeOrg: UserOrganization): boolean => {
	return activeOrg.roles.findIndex((role) => role === "admin" || role === "owner") > -1
}

export function RemoteConfigToggle({ activeOrganization }: { activeOrganization: UserOrganization | null }) {
	const { optOutOfRemoteConfig } = useExtensionState()
	const hadOptedOutOfRemoteConfig = useRef(optOutOfRemoteConfig)

	// If there is no active org but the user had already opted out, keep displaying the toggle
	if (!hadOptedOutOfRemoteConfig.current && activeOrganization && !isAdminOrOwner(activeOrganization)) {
		return null
	}

	const onUpdateToggle = async (value: boolean) => {
		await StateServiceClient.updateSettings(
			UpdateSettingsRequest.create({
				optOutOfRemoteConfig: value,
			}),
		)
	}

	return (
		<VSCodeCheckbox
			checked={optOutOfRemoteConfig}
			onChange={(e: any) => {
				const isChecked = e.target.checked === true

				onUpdateToggle(isChecked)
			}}>
			Opt out of remote config
		</VSCodeCheckbox>
	)
}
