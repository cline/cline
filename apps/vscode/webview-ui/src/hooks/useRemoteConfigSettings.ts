import { useCallback, useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { RemoteConfigServiceClient } from "@/services/grpc-client"

export interface RemoteConfigSetting {
	type: "rule" | "workflow" | "skill"
	name: string
	content: string
	enabled: boolean
	locked: boolean
	toggle: (enabled: boolean) => void
}

export interface RemoteConfigSettingsState {
	settings: RemoteConfigSetting[]
	isLoading: boolean
	error?: string
}

type ProtoSetting = Awaited<ReturnType<typeof RemoteConfigServiceClient.getRemoteConfigSettings>>["settings"][number]

function settingType(type: ProtoSetting["type"]): RemoteConfigSetting["type"] {
	return type === 0 ? "rule" : type === 1 ? "workflow" : "skill"
}

export default function useRemoteConfigSettings(isVisible: boolean): RemoteConfigSettingsState {
	const { remoteConfigRevision } = useExtensionState()
	const [state, setState] = useState<Omit<RemoteConfigSettingsState, "settings"> & { settings: ProtoSetting[] }>({
		settings: [],
		isLoading: false,
	})

	const toggle = useCallback(async (setting: ProtoSetting, enabled: boolean) => {
		setState((current) => ({ ...current, error: undefined }))
		try {
			const updated = await RemoteConfigServiceClient.toggleRemoteConfigSetting({
				type: setting.type,
				name: setting.name,
				enabled,
			})
			setState((current) => ({
				...current,
				settings: current.settings.map((entry) =>
					entry.type === updated.type && entry.name === updated.name ? updated : entry,
				),
			}))
		} catch (error) {
			setState((current) => ({
				...current,
				error: error instanceof Error ? error.message : "Failed to update managed configuration",
			}))
		}
	}, [])

	useEffect(() => {
		if (!isVisible) {
			return
		}

		let isCancelled = false
		setState((current) => ({ ...current, isLoading: true, error: undefined }))

		RemoteConfigServiceClient.getRemoteConfigSettings({})
			.then((response) => {
				if (!isCancelled) {
					setState({ settings: response.settings, isLoading: false })
				}
			})
			.catch((error) => {
				if (!isCancelled) {
					setState((current) => ({
						...current,
						isLoading: false,
						error: error instanceof Error ? error.message : "Failed to load managed configuration",
					}))
				}
			})

		return () => {
			isCancelled = true
		}
	}, [isVisible, remoteConfigRevision])

	return {
		...state,
		settings: state.settings.map((setting) => ({
			type: settingType(setting.type),
			name: setting.name,
			content: setting.content,
			enabled: setting.enabled,
			locked: setting.locked,
			toggle: (enabled) => void toggle(setting, enabled),
		})),
	}
}
