import { UpdateSettingsRequest, UserOrganization } from "@shared/proto/index.cline"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { isAdminOrOwner } from "./helpers"

export function RemoteConfigToggle({ activeOrganization }: { activeOrganization: UserOrganization | null }) {
	const { optOutOfRemoteConfig, remoteConfigAvailable } = useExtensionState()

	if (!activeOrganization || !isAdminOrOwner(activeOrganization) || !remoteConfigAvailable) {
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
