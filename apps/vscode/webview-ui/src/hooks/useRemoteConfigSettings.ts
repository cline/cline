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
	// TODO(ENG): The backend handler is not implemented yet and currently
	// rejects. Handle the result (e.g. update UI state) once toggling is wired
	// up; for now swallow the rejection so it doesn't surface as an unhandled
	// promise rejection.
	RemoteConfigServiceClient.toggleRemoteConfigSetting({ value: settingName }).catch(() => {})
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
