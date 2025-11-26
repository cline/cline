import React from "react"
import { Input } from "@/components/ui/Input"
import { FormField } from "../common/FormField"
import { useSettingsContext } from "@/context/settings"

interface BailingProviderProps {
	onConfigChange?: () => void
}

export function BailingProvider({ onConfigChange }: BailingProviderProps) {
	const { apiConfiguration, updateApiConfiguration } = useSettingsContext()

	const handleApiKeyChange = (value: string) => {
		updateApiConfiguration({ bailingApiKey: value })
		onConfigChange?.()
	}

	return (
		<div className="flex flex-col gap-4">
			<FormField
				label="API Key"
				description="Enter your Bailing API key. You can find this in your Bailing dashboard."
			>
				<Input
					type="password"
					value={apiConfiguration.bailingApiKey || ""}
					onChange={(e) => handleApiKeyChange(e.target.value)}
					placeholder="sk-..."
				/>
			</FormField>
		</div>
	)
}

