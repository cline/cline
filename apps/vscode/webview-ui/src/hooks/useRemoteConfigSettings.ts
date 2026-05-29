import { useEffect, useState } from "react"
import { RemoteConfigServiceClient } from "@/services/grpc-client"

export interface RemoteConfigSetting {
	type: "rule" | "workflow" | "skill"
	name: string
	content: string
	enabled: boolean
	locked: boolean
	toggle: () => void
}

function toggleRemoteConfigSetting(settingName: string) {
	RemoteConfigServiceClient.toggleRemoteConfigSetting({ value: settingName }).then((_toggleResult) => {
		// TODO: Handle toggle result if needed, e.g., show a success message or update the UI state
	})
}

export default function useRemoteConfigSettings(isVisible: boolean): RemoteConfigSetting[] {
	const [remoteConfigSettings, setRemoteConfigSettings] = useState<RemoteConfigSetting[]>([])

	useEffect(() => {
		if (!isVisible) {
			return
		}

		let isCancelled = false

		RemoteConfigServiceClient.getRemoteConfigSettings({}).then((response) => {
			if (isCancelled) {
				return
			}

			const settings = response.settings.map(
				(setting) =>
					({
						type: setting.type === 0 ? "rule" : setting.type === 1 ? "workflow" : "skill",
						name: setting.name,
						content: setting.content,
						enabled: setting.enabled,
						locked: setting.locked,
						toggle: () => {
							toggleRemoteConfigSetting(setting.name)
						},
					}) as RemoteConfigSetting,
			)
			setRemoteConfigSettings(settings)
		})

		return () => {
			isCancelled = true
		}
	}, [isVisible])

	return remoteConfigSettings
}
